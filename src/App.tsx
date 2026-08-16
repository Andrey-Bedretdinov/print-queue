import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'framer-motion'
import type { AppState, Job, Printer } from '../shared/types'
import type { ToastMessage } from '../shared/ipc'
import { api } from './lib/api'
import { TitleBar } from './components/TitleBar'
import { Toolbar, type Filter } from './components/Toolbar'
import { Rail } from './components/Rail'
import { Column } from './components/Column'
import { JobRow } from './components/JobRow'
import { PreviewModal } from './components/PreviewModal'
import { Incidents } from './components/Incidents'
import { AlertBar } from './components/AlertBar'
import { Toasts } from './components/Toasts'
import { PrinterPicker } from './components/PrinterPicker'

export interface ColumnView {
  printer: Printer
  jobs: Job[]
}

export type DragKind = 'job' | 'column' | null

const isOpen = (j: Job) => j.state === 'queued' || j.state === 'printing' || j.state === 'paused'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Job | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [picker, setPicker] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [drag, setDrag] = useState<Job | null>(null)
  const [colDrag, setColDrag] = useState<Printer | null>(null)
  const [override, setOverride] = useState<Record<string, string[]> | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [fileOver, setFileOver] = useState(false)

  const dragRef = useRef(false)
  const pendingRef = useRef<AppState | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  // ------------------------------------------------------------- lifecycle

  useEffect(() => {
    let alive = true
    api.getState().then((s) => {
      if (alive && s) setState(s)
    })
    const offState = api.onState((s) => {
      // A drag is the local truth for its duration; server pushes replay after.
      if (dragRef.current) {
        pendingRef.current = s
        return
      }
      setState(s)
    })
    const offToast = api.onToast((t) => {
      setToasts((prev) => [...prev.slice(-3), t])
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 6000)
    })
    return () => {
      alive = false
      offState()
      offToast()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = state?.settings.theme ?? 'light'
  }, [state?.settings.theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (preview) setPreview(null)
        else if (drawer) setDrawer(false)
      }
      if (e.key === 'f' && e.ctrlKey) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, drawer])

  /** Vertical wheel scrolls the board sideways unless a queue can still scroll. */
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || e.ctrlKey) return
      const body = (e.target as HTMLElement)?.closest?.('.col-body') as HTMLElement | null
      if (body && body.scrollHeight > body.clientHeight + 1) {
        const up = e.deltaY < 0
        const atTop = body.scrollTop <= 0
        const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 1
        if (!((up && atTop) || (!up && atEnd))) return
      }
      e.preventDefault()
      board.scrollLeft += e.deltaY
    }
    board.addEventListener('wheel', onWheel, { passive: false })
    return () => board.removeEventListener('wheel', onWheel)
    // The board only exists once the first state has arrived.
  }, [state !== null])

  // ---------------------------------------------------------------- derive

  const settings = state?.settings
  const hidden = useMemo(() => settings?.hidden ?? [], [settings?.hidden])
  const orderPref = useMemo(() => settings?.order ?? [], [settings?.order])

  const jobMap = useMemo(() => {
    const map = new Map<string, Job>()
    for (const j of state?.jobs ?? []) map.set(j.id, j)
    return map
  }, [state?.jobs])

  const visiblePrinters = useMemo(() => {
    const list = (state?.printers ?? []).filter((p) => !hidden.includes(p.id))
    const rank = (id: string) => {
      const i = orderPref.indexOf(id)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...list].sort((a, b) => rank(a.id) - rank(b.id))
  }, [state?.printers, hidden, orderPref])

  const baseColumns = useMemo<ColumnView[]>(() => {
    if (!state) return []
    const q = query.trim().toLowerCase()
    return visiblePrinters.map((printer) => {
      const jobs = state.jobs
        .filter((j) => j.printerId === printer.id)
        .filter((j) => (q ? j.name.toLowerCase().includes(q) : true))
        .filter((j) => {
          if (filter === 'active') return isOpen(j)
          if (filter === 'error') return j.state === 'error'
          return j.state !== 'canceled'
        })
      const rank = (j: Job) => (j.state === 'error' ? 0 : isOpen(j) ? 1 : 2)
      jobs.sort((a, b) => rank(a) - rank(b))
      return { printer, jobs }
    })
  }, [state, visiblePrinters, query, filter])

  const columns = useMemo<ColumnView[]>(() => {
    if (!override) return baseColumns
    return baseColumns.map((col) => {
      const ids = override[col.printer.id]
      if (!ids) return col
      const jobs = ids.map((id) => jobMap.get(id)).filter((j): j is Job => !!j)
      return { printer: col.printer, jobs }
    })
  }, [baseColumns, override, jobMap])

  const incidents = state?.incidents ?? []
  const activeIncidents = useMemo(
    () => incidents.filter((i) => !i.resolved && !i.dismissed),
    [incidents],
  )

  const totals = useMemo(() => {
    const ids = new Set(visiblePrinters.map((p) => p.id))
    const jobs = (state?.jobs ?? []).filter((j) => ids.has(j.printerId))
    return {
      printers: visiblePrinters.length,
      queued: jobs.filter(isOpen).length,
      errors: jobs.filter((j) => j.state === 'error').length,
      hidden: hidden.length,
    }
  }, [state?.jobs, visiblePrinters, hidden])

  // ----------------------------------------------------------------- drag

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const dragKind: DragKind = drag ? 'job' : colDrag ? 'column' : null

  const printerOf = useCallback(
    (id: string) => {
      if (id.startsWith('col:')) return id.slice(4)
      if (id.startsWith('rail:')) return id.slice(5)
      if (id.startsWith('pcol:')) return id.slice(5)
      for (const col of columns) {
        if (col.jobs.some((j) => j.id === id)) return col.printer.id
      }
      return null
    },
    [columns],
  )

  const containerOf = useCallback((id: string, map: Record<string, string[]>) => {
    if (id.startsWith('col:')) return id.slice(4)
    if (id.startsWith('rail:')) return id.slice(5)
    if (id.startsWith('pcol:')) return id.slice(5)
    for (const [printerId, ids] of Object.entries(map)) {
      if (ids.includes(id)) return printerId
    }
    return null
  }, [])

  const snapshot = useCallback(() => {
    const map: Record<string, string[]> = {}
    for (const col of baseColumns) map[col.printer.id] = col.jobs.map((j) => j.id)
    return map
  }, [baseColumns])

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    if (id.startsWith('pcol:')) {
      const printer = visiblePrinters.find((p) => p.id === id.slice(5))
      if (!printer) return
      dragRef.current = true
      setColDrag(printer)
      return
    }
    const job = jobMap.get(id)
    if (!job) return
    dragRef.current = true
    setDrag(job)
    setOverride(snapshot())
  }

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (colDrag) {
      setOverCol(over ? printerOf(String(over.id)) : null)
      return
    }
    if (!over || !override) {
      setOverCol(null)
      return
    }
    const from = containerOf(String(active.id), override)
    const to = containerOf(String(over.id), override)
    setOverCol(to)
    if (!from || !to || from === to) return
    setOverride((prev) => {
      if (!prev) return prev
      const source = prev[from].filter((id) => id !== active.id)
      const target = [...(prev[to] ?? [])]
      const overIndex = target.indexOf(String(over.id))
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id))
      return { ...prev, [from]: source, [to]: target }
    })
  }

  const release = () => {
    dragRef.current = false
    setDrag(null)
    setColDrag(null)
    setOverride(null)
    setOverCol(null)
    if (pendingRef.current) {
      setState(pendingRef.current)
      pendingRef.current = null
    }
  }

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e

    if (colDrag) {
      const target = over ? printerOf(String(over.id)) : null
      const ids = visiblePrinters.map((p) => p.id)
      const from = ids.indexOf(colDrag.id)
      const to = target ? ids.indexOf(target) : -1
      release()
      if (from >= 0 && to >= 0 && from !== to) {
        const next = arrayMove(ids, from, to)
        const rest = orderPref.filter((id) => !next.includes(id))
        await api.settings({ order: [...next, ...rest] })
      }
      return
    }

    const map = override
    if (!over || !map) return release()
    const from = containerOf(String(active.id), map)
    const to = containerOf(String(over.id), map)
    if (!from || !to) return release()

    let ids = map[to] ?? []
    if (from === to) {
      const oldIndex = ids.indexOf(String(active.id))
      const newIndex = ids.indexOf(String(over.id))
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        ids = arrayMove(ids, oldIndex, newIndex)
      }
    }
    const position = Math.max(0, ids.indexOf(String(active.id)))
    const jobId = String(active.id)

    dragRef.current = false
    setDrag(null)
    setOverCol(null)
    setOverride({ ...map, [to]: ids })

    const res = await api.moveJob(jobId, to, position)
    if (!res?.ok) {
      pushToast('warn', 'Перенос не выполнен', res?.reason)
    } else if (from !== to) {
      const target = state?.printers.find((p) => p.id === to)
      pushToast('info', jobMap.get(jobId)?.name ?? 'Задание', `→ ${target?.name ?? ''}`)
    }
    setOverride(null)
    if (pendingRef.current) {
      setState(pendingRef.current)
      pendingRef.current = null
    }
  }

  function pushToast(kind: ToastMessage['kind'], text: string, sub?: string) {
    const toast: ToastMessage = { id: Math.random().toString(36).slice(2), kind, text, sub }
    setToasts((prev) => [...prev.slice(-3), toast])
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== toast.id)), 5000)
  }

  // -------------------------------------------------------------- actions

  const addFiles = useCallback(
    async (paths: string[], printerId: string) => {
      if (!paths.length) return
      const res = await api.addFiles(paths, printerId)
      const printer = state?.printers.find((p) => p.id === printerId)
      if (res?.ok) pushToast('info', `${res.added} файл(ов) в очередь`, printer?.name)
      else pushToast('warn', 'Не удалось добавить файлы', printer?.name)
    },
    [state?.printers],
  )

  const pickFiles = useCallback(
    async (printerId?: string) => {
      const target = printerId ?? selected ?? visiblePrinters[0]?.id
      if (!target) return
      const paths = await api.pickFiles()
      await addFiles(paths, target)
    },
    [addFiles, selected, visiblePrinters],
  )

  const focusPrinter = (id: string) => {
    setSelected(id)
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-col="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  const toggleHidden = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]
    api.settings({ hidden: next })
  }

  if (!state || !settings) {
    return (
      <div className="app">
        <TitleBar query="" onQuery={() => {}} alerts={0} onAlerts={() => {}} theme="light" onTheme={() => {}} />
        <div />
        <div className="blank" style={{ alignContent: 'center' }}>
          Подключение к спулеру…
        </div>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={release}
    >
      <div
        className="app"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setFileOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setFileOver(false)
        }}
        onDrop={() => setFileOver(false)}
      >
        <TitleBar
          query={query}
          onQuery={setQuery}
          alerts={activeIncidents.length}
          onAlerts={() => setDrawer((v) => !v)}
          theme={settings.theme}
          onTheme={() => api.settings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
        />

        <Toolbar
          filter={filter}
          onFilter={setFilter}
          totals={totals}
          settings={settings}
          systemAvailable={state.systemAvailable}
          pickerOpen={picker}
          onAdd={() => pickFiles()}
          onPicker={() => setPicker((v) => !v)}
          onToggleSim={() => api.settings({ simulation: !settings.simulation })}
          onToggleRail={() => api.settings({ railCollapsed: !settings.railCollapsed })}
        >
          <AnimatePresence>
            {picker && (
              <PrinterPicker
                printers={state.printers}
                hidden={hidden}
                onToggle={toggleHidden}
                onAll={(visible) =>
                  api.settings({ hidden: visible ? [] : state.printers.map((p) => p.id) })
                }
                onClose={() => setPicker(false)}
              />
            )}
          </AnimatePresence>
        </Toolbar>

        <div className="body" style={{ position: 'relative' }}>
          <Rail
            columns={baseColumns}
            collapsed={settings.railCollapsed}
            selected={selected}
            onSelect={focusPrinter}
            onDropFiles={addFiles}
          />

          <div className="board-wrap">
            <AnimatePresence initial={false}>
              {activeIncidents.length > 0 && !drawer && (
                <AlertBar
                  incidents={activeIncidents}
                  onOpen={() => setDrawer(true)}
                  onDismissAll={() => api.incident('dismiss-all')}
                />
              )}
            </AnimatePresence>

            <div className="board" ref={boardRef}>
              {columns.map((col) => (
                <Column
                  key={col.printer.id}
                  column={col}
                  dragKind={dragKind}
                  dragging={colDrag?.id === col.printer.id}
                  dropTarget={overCol === col.printer.id}
                  selected={selected === col.printer.id}
                  onSelect={setSelected}
                  onPreview={setPreview}
                  onDropFiles={addFiles}
                  onAdd={() => pickFiles(col.printer.id)}
                />
              ))}
              {columns.length === 0 && (
                <div className="blank" style={{ margin: 'auto' }}>
                  {hidden.length ? 'Все принтеры скрыты' : 'Принтеры не найдены'}
                </div>
              )}
            </div>
          </div>

          <AnimatePresence>
            {drawer && (
              <Incidents
                incidents={incidents}
                printers={visiblePrinters}
                onClose={() => setDrawer(false)}
                onPreview={(inc) =>
                  setPreview({
                    id: inc.id,
                    printerId: inc.printerId,
                    name: inc.jobName,
                    ext: inc.ext,
                    path: inc.path,
                    bytes: 0,
                    pages: inc.pages,
                    printedPages: 0,
                    copies: 1,
                    owner: '',
                    state: 'error',
                    submittedAt: inc.at,
                    signature: inc.signature,
                    source: 'sim',
                    retries: 0,
                  })
                }
              />
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {preview && <PreviewModal job={preview} onClose={() => setPreview(null)} />}
        </AnimatePresence>

        <Toasts items={toasts} onClose={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />

        {fileOver && <div className="drop-hint">Отпустите файлы на принтере</div>}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22,0.61,0.36,1)' }}>
        {drag && (
          <motion.div initial={{ scale: 1 }} animate={{ scale: 1.02 }} style={{ width: 252 }}>
            <JobRow job={drag} overlay />
          </motion.div>
        )}
        {colDrag && (
          <div className="col-ghost">
            <span className={`led ${colDrag.state}`} />
            <b>{colDrag.name}</b>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
