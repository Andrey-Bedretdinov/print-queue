import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { THEMES, type AppState, type Job, type Printer } from '../shared/types'
import type { ToastMessage } from '../shared/ipc'
import { api } from './lib/api'
import { playStartSound } from './lib/sounds'
import { cheer } from './lib/cheer'
import { Cat } from './components/Cat'
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
import { ContextMenu, type MenuTarget } from './components/ContextMenu'

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
  const [settling, setSettling] = useState<{ ids: string[]; to: string } | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [fileOver, setFileOver] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const anchorRef = useRef<string | null>(null)

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

  /**
   * Отбивка на старт печати. Сравниваем с прошлым снимком очереди: интересен
   * переход в «печатается», а не сам факт. Первый снимок молчит — то, что уже
   * шло до запуска приложения, новостью не является.
   */
  const printingRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    const jobs = state?.jobs
    if (!jobs) return
    const now = new Set(jobs.filter((j) => j.state === 'printing').map((j) => j.id))
    const seen = printingRef.current
    printingRef.current = now
    if (!seen || !state?.settings.sound) return
    // Пачка заданий стартует разом — звук один, а не хор.
    for (const id of now) {
      if (!seen.has(id)) {
        playStartSound()
        cheer()
        break
      }
    }
  }, [state?.jobs, state?.settings.sound])

  /**
   * После переноса очередь какое-то время отдаёт ещё дореносное состояние.
   * Оптимистичная раскладка снимается, только когда сервер и сам считает, что
   * задание переехало: либо оно уже на целевом принтере, либо исчезло — перенос
   * заводит на приёмнике новый номер, а старый удаляет.
   */
  useEffect(() => {
    if (!settling || !state) return
    const settled = settling.ids.every((id) => {
      const job = state.jobs.find((j) => j.id === id)
      return (
        !job ||
        job.printerId === settling.to ||
        job.state === 'canceled' ||
        job.state === 'completed'
      )
    })
    if (!settled) return
    setSettling(null)
    setOverride(null)
  }, [state, settling])

  /** Страховка: если подтверждение так и не пришло, раскладка не залипает навсегда. */
  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => {
      setSettling(null)
      setOverride(null)
    }, 20_000)
    return () => clearTimeout(timer)
  }, [settling])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (preview) setPreview(null)
        else if (menu) setMenu(null)
        else if (drawer) setDrawer(false)
        else setSelection(new Set())
      }
      if (e.key === 'a' && e.ctrlKey) {
        e.preventDefault()
        setSelection(new Set((state?.jobs ?? []).map((j) => j.id)))
      }
      if (e.key === 'f' && e.ctrlKey) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, drawer, menu, state?.jobs])

  /** Vertical wheel scrolls the board sideways unless a queue can still scroll. */
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || e.ctrlKey) return
      if (board.classList.contains('grid')) return
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

  /** Авто-высота: блоки делят высоту окна на строки без остатка внизу. */
  const [autoHeight, setAutoHeight] = useState(0)

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
    const listed = new Set(Object.values(override).flat())
    return baseColumns.map((col) => {
      const ids = override[col.printer.id]
      if (!ids) return col
      const jobs = ids.map((id) => jobMap.get(id)).filter((j): j is Job => !!j)
      // Перенос заводит на целевом принтере задание с новым номером, а старое
      // удаляет. В раскладке этот номер не значится, и без такой добавки строка
      // пропадала бы на миг между «перенесли» и «спулер подтвердил».
      const fresh = col.jobs.filter((j) => !listed.has(j.id))
      return { printer: col.printer, jobs: [...jobs, ...fresh] }
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

  const grid = settings?.layout === 'grid'
  const cardHeight = settings ? (settings.cardAuto && autoHeight ? autoHeight : settings.cardHeight) : 240

  const autoRef = useRef(0)

  useLayoutEffect(() => {
    const board = boardRef.current
    if (!grid || !settings?.cardAuto || !board || columns.length === 0) return
    let frame = 0
    const compute = () => {
      const style = getComputedStyle(board)
      const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length || 1
      const gap = parseFloat(style.rowGap) || 8
      const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      const rows = Math.max(1, Math.ceil(columns.length / cols))
      const free = board.clientHeight - pad - (rows - 1) * gap
      const next = Math.max(132, Math.floor(free / rows))
      // Порог гасит колебания «появился скроллбар — изменилась высота — исчез».
      if (Math.abs(next - autoRef.current) <= 2) return
      autoRef.current = next
      setAutoHeight(next)
    }
    compute()
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(compute)
    })
    ro.observe(board)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [grid, settings?.cardAuto, columns.length])

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
    // Тянем всё выделение, только если тянут за выделенную строку.
    if (!selection.has(id)) setSelection(new Set())
    setMenu(null)
    dragRef.current = true
    setDrag(job)
    // Новый захват задаёт раскладку заново — ждать подтверждения по прошлому
    // переносу больше незачем, иначе оно снимет уже чужую раскладку.
    setSettling(null)
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
    const others = selection.has(jobId) ? [...selection].filter((id) => id !== jobId) : []
    for (const id of others) await api.moveJob(id, to, Number.MAX_SAFE_INTEGER)
    if (others.length) setSelection(new Set())
    if (!res?.ok) {
      pushToast(
        'warn',
        'Перенос не выполнен',
        res?.reason,
        res?.needsAdmin ? 'elevate' : res?.needsSpooling ? 'spool' : undefined,
        res?.needsSpooling,
      )
    } else if (from !== to) {
      cheer()
      const target = state?.printers.find((p) => p.id === to)
      const label = others.length
        ? `${others.length + 1} задания`
        : (jobMap.get(jobId)?.name ?? 'Задание')
      pushToast('info', label, `→ ${target?.name ?? ''}`)
    }
    if (pendingRef.current) {
      setState(pendingRef.current)
      pendingRef.current = null
    }
    // Раскладку держим, пока спулер не отчитается: очередь опрашивается не в
    // такт с переносом, и сброс сразу возвращал задание в старый блок на секунду.
    if (res?.ok) setSettling({ ids: [jobId, ...others], to })
    else setOverride(null)
  }

  function pushToast(
    kind: ToastMessage['kind'],
    text: string,
    sub?: string,
    action?: ToastMessage['action'],
    actionArg?: string,
  ) {
    const toast: ToastMessage = {
      id: Math.random().toString(36).slice(2),
      kind,
      text,
      sub,
      action,
      actionArg,
    }
    setToasts((prev) => [...prev.slice(-3), toast])
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== toast.id)), action ? 15000 : 5000)
  }

  // -------------------------------------------------------------- actions

  const addFiles = useCallback(
    async (paths: string[], printerId: string) => {
      if (!paths.length) return
      const res = await api.addFiles(paths, printerId)
      const printer = state?.printers.find((p) => p.id === printerId)
      if (res?.ok) {
        cheer()
        pushToast('info', `${res.added} файл(ов) в очередь`, printer?.name)
      }
      else pushToast('warn', 'Не удалось добавить файлы', printer?.name)
    },
    [state?.printers],
  )

  /** Диалог выбора файлов: перетаскивание из проводника блокирует UIPI. */
  const pickFiles = useCallback(
    async (printerId: string) => {
      const paths = await api.pickFiles()
      await addFiles(paths, printerId)
    },
    [addFiles],
  )

  const focusPrinter = (id: string) => {
    setSelected(id)
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-col="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  /** Клик — выделить, Ctrl — добавить, Shift — диапазон внутри очереди. */
  const selectJob = (job: Job, e: React.MouseEvent) => {
    const column = columns.find((c) => c.printer.id === job.printerId)
    const ids = column?.jobs.map((j) => j.id) ?? []
    setSelection((prev) => {
      if (e.shiftKey && anchorRef.current && ids.includes(anchorRef.current)) {
        const a = ids.indexOf(anchorRef.current)
        const b = ids.indexOf(job.id)
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
        return new Set(e.ctrlKey ? [...prev, ...range] : range)
      }
      anchorRef.current = job.id
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(prev)
        next.has(job.id) ? next.delete(job.id) : next.add(job.id)
        return next
      }
      return prev.size === 1 && prev.has(job.id) ? new Set() : new Set([job.id])
    })
  }

  const openMenu = (job: Job, e: React.MouseEvent) => {
    const ids = selection.has(job.id) ? [...selection] : [job.id]
    if (!selection.has(job.id)) setSelection(new Set([job.id]))
    const jobs = ids.map((id) => jobMap.get(id)).filter((j): j is Job => !!j)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      jobIds: ids,
      printerId: job.printerId,
      // Страницу системного задания показываем снимком из очереди — файл не нужен.
      canPreview: ids.length === 1 && (!!job.path || job.source === 'system'),
      canPause: jobs.some((j) => j.state === 'queued' || j.state === 'printing'),
      canRetry: jobs.some((j) => j.state === 'error' && j.source === 'sim'),
    })
  }

  const moveMany = async (jobIds: string[], printerId: string) => {
    const target = state?.printers.find((p) => p.id === printerId)
    let moved = 0
    let reason: string | undefined
    let needsAdmin = false
    let needsSpooling: string | undefined
    for (const id of jobIds) {
      const res = await api.moveJob(id, printerId, Number.MAX_SAFE_INTEGER)
      if (res?.ok) moved += 1
      else {
        reason = res?.reason
        needsAdmin = needsAdmin || !!res?.needsAdmin
        needsSpooling = needsSpooling ?? res?.needsSpooling
      }
    }
    if (moved) pushToast('info', `${moved} задание(й) → ${target?.name ?? ''}`)
    if (moved < jobIds.length) {
      pushToast(
        'warn',
        'Часть заданий осталась',
        reason,
        needsAdmin ? 'elevate' : needsSpooling ? 'spool' : undefined,
        needsSpooling,
      )
    }
    setSelection(new Set())
  }

  const menuJobs = () => (menu?.jobIds ?? []).map((id) => jobMap.get(id)).filter((j): j is Job => !!j)

  const toggleHidden = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]
    api.settings({ hidden: next })
  }

  if (!state || !settings) {
    return (
      <div className="app">
        <TitleBar
          query=""
          onQuery={() => {}}
          alerts={0}
          onAlerts={() => {}}
          theme="light"
          onTheme={() => {}}
          sound={false}
          onSound={() => {}}
        />
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
          onTheme={() =>
            api.settings({ theme: THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length] })
          }
          sound={settings.sound}
          onSound={() => {
            // Включение слышно сразу: иначе непонятно, что именно включилось.
            if (!settings.sound) playStartSound()
            void api.settings({ sound: !settings.sound })
          }}
        />

        <Toolbar
          filter={filter}
          onFilter={setFilter}
          totals={totals}
          settings={settings}
          systemAvailable={state.systemAvailable}
          version={state.version}
          needsAdmin={!state.canMoveSystem && visiblePrinters.some((p) => p.source === 'system')}
          pickerOpen={picker}
          onElevate={async () => {
            const ok = await api.elevate()
            if (!ok) {
              pushToast('warn', 'Не удалось перезапустить', 'Запустите приложение от администратора вручную')
            }
          }}
          onPicker={() => setPicker((v) => !v)}
          onToggleSim={() => api.settings({ simulation: !settings.simulation })}
          onToggleRail={() => api.settings({ railCollapsed: !settings.railCollapsed })}
          cardHeight={cardHeight}
          onLayout={(layout) => api.settings({ layout })}
          onCardHeight={(value) => api.settings({ cardHeight: value, cardAuto: false })}
          onCardAuto={() => api.settings({ cardAuto: !settings.cardAuto })}
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
                onPrepare={async () => {
                  const targets = state.printers.filter((p) => p.source === 'system')
                  let done = 0
                  for (const p of targets) {
                    const res = await api.enableSpooling(p.id)
                    if (res?.ok) done += 1
                  }
                  setPicker(false)
                  pushToast(
                    done ? 'ok' : 'warn',
                    `Перенос разрешён: ${done} из ${targets.length}`,
                    done ? 'Задания будут сохраняться до переноса' : 'Не хватило прав',
                  )
                }}
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

            <div
              className={`board${grid ? ' grid' : ''}`}
              ref={boardRef}
              style={{ ['--card-h' as string]: `${cardHeight}px` }}
              onClick={(e) => e.target === e.currentTarget && setSelection(new Set())}
            >
              {columns.map((col) => (
                <Column
                  key={col.printer.id}
                  column={col}
                  dragKind={dragKind}
                  dragging={colDrag?.id === col.printer.id}
                  dropTarget={overCol === col.printer.id}
                  selected={selected === col.printer.id}
                  grid={grid}
                  cardHeight={cardHeight}
                  selection={selection}
                  onSelect={setSelected}
                  onSelectJob={selectJob}
                  onMenuJob={openMenu}
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

        <AnimatePresence>
          {menu && (
            <ContextMenu
              target={menu}
              printers={visiblePrinters}
              onMove={(printerId) => {
                const ids = menu.jobIds
                setMenu(null)
                void moveMany(ids, printerId)
              }}
              onPreview={() => {
                const job = menuJobs()[0]
                setMenu(null)
                if (job) setPreview(job)
              }}
              onPause={() => {
                menuJobs().forEach((j) => api.jobAction(j.id, 'pause'))
                setMenu(null)
              }}
              onRetry={() => {
                menuJobs().forEach((j) => api.jobAction(j.id, 'retry'))
                setMenu(null)
              }}
              onCancel={() => {
                menuJobs().forEach((j) => api.jobAction(j.id, 'cancel'))
                setMenu(null)
                setSelection(new Set())
              }}
              onClose={() => setMenu(null)}
            />
          )}
        </AnimatePresence>

        <Cat active={settings.theme === 'pink'} />

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
