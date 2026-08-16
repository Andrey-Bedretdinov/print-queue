import { useLayoutEffect, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { motion } from 'framer-motion'
import type { Job } from '../../shared/types'
import { PRINTER_STATE_LABEL } from '../../shared/types'
import type { ColumnView, DragKind } from '../App'
import { api } from '../lib/api'
import { hasFiles, pathsFrom } from '../lib/files'
import { eta } from '../lib/format'
import { JobRow } from './JobRow'
import {
  IcoAlert,
  IcoChevronDown,
  IcoNet,
  IcoPause,
  IcoPlay,
  IcoPlus,
  IcoPower,
  IcoTrash,
  IcoUsb,
  IcoWrench,
} from './icons'

interface Props {
  column: ColumnView
  dragKind: DragKind
  dragging: boolean
  dropTarget: boolean
  selected: boolean
  grid: boolean
  cardHeight: number
  selection: Set<string>
  onSelect: (id: string) => void
  onSelectJob: (job: Job, e: React.MouseEvent) => void
  onMenuJob: (job: Job, e: React.MouseEvent) => void
  onPreview: (job: Job) => void
  onDropFiles: (paths: string[], printerId: string) => void
  onAdd: () => void
}

/** Высота строки очереди + зазор — по ней считаем, сколько заданий не влезло. */
const ROW = 26

export function Column({
  column,
  dragKind,
  dragging,
  dropTarget,
  selected,
  grid,
  cardHeight,
  selection,
  onSelect,
  onSelectJob,
  onMenuJob,
  onPreview,
  onDropFiles,
  onAdd,
}: Props) {
  const { printer, jobs } = column
  const { setNodeRef, isOver } = useDroppable({ id: `col:${printer.id}` })
  const handle = useDraggable({ id: `pcol:${printer.id}`, disabled: dragKind === 'job' })
  const [fileOver, setFileOver] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!grid || !el) {
      setOverflow(0)
      return
    }
    const fits = Math.max(1, Math.floor((el.clientHeight - 4) / ROW))
    setOverflow(Math.max(0, jobs.length - fits))
  }, [grid, jobs.length, cardHeight, expanded])

  useLayoutEffect(() => {
    if (!grid) setExpanded(false)
  }, [grid])

  const open = jobs.filter((j) => j.state !== 'completed' && j.state !== 'canceled')
  const errors = open.filter((j) => j.state === 'error')
  const remaining = open.reduce((sum, j) => sum + (j.pages * j.copies - j.printedPages), 0)
  const seconds = printer.speed > 0 ? (remaining / printer.speed) * 60 : 0
  const broken = printer.state === 'error' || printer.state === 'offline'

  const stopDrag = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() }

  return (
    <motion.div
      layout="position"
      transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }}
      ref={setNodeRef}
      data-col={printer.id}
      className={
        'col' +
        (isOver || fileOver || dropTarget ? ' over' : '') +
        (printer.state === 'offline' ? ' dim' : '') +
        (dragging ? ' lifted' : '') +
        (expanded ? ' expanded' : '') +
        (grid && overflow > 0 && !expanded ? ' clipped' : '')
      }
      onClick={() => onSelect(printer.id)}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setFileOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setFileOver(false)
        onDropFiles(pathsFrom(e), printer.id)
      }}
      style={selected ? { borderColor: 'var(--primary-line)' } : undefined}
    >
      <div
        className="col-head"
        ref={handle.setNodeRef}
        {...handle.attributes}
        {...handle.listeners}
        title="Перетащите, чтобы переставить принтер"
      >
        <span className={`led ${printer.state}`} />
        <span className="col-title">
          <b>{printer.name}</b>
          <i>
            {printer.connection === 'network' ? <IcoNet size={10} /> : <IcoUsb size={10} />}
            <span>{printer.address}</span>
            <span style={{ color: 'var(--line-strong)' }}>·</span>
            <span>{printer.detail ?? PRINTER_STATE_LABEL[printer.state]}</span>
            {printer.direct && (
              <span style={{ color: 'var(--warn)' }} title="Печать идёт мимо очереди — задания нельзя перенести">
                · без очереди
              </span>
            )}
          </i>
        </span>
        <span className="col-actions">
          <button
            className="icon-btn tip"
            data-tip="Добавить файлы"
            {...stopDrag}
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
          >
            <IcoPlus size={13} />
          </button>
          <button
            className="icon-btn tip"
            data-tip={printer.paused ? 'Продолжить' : 'Пауза'}
            {...stopDrag}
            onClick={(e) => {
              e.stopPropagation()
              api.printerAction(printer.id, printer.paused ? 'resume' : 'pause')
            }}
          >
            {printer.paused ? <IcoPlay size={13} /> : <IcoPause size={13} />}
          </button>
          {printer.source === 'sim' && (
            <button
              className="icon-btn tip"
              data-tip={printer.state === 'offline' ? 'Включить' : 'Выключить'}
              {...stopDrag}
              onClick={(e) => {
                e.stopPropagation()
                api.printerAction(printer.id, 'toggle-power')
              }}
            >
              <IcoPower size={13} />
            </button>
          )}
          <button
            className="icon-btn danger tip"
            data-tip="Очистить"
            {...stopDrag}
            onClick={(e) => {
              e.stopPropagation()
              api.printerAction(printer.id, 'clear')
            }}
          >
            <IcoTrash size={13} />
          </button>
        </span>
      </div>

      {broken && printer.source === 'sim' && (
        <div className="col-alert">
          <IcoAlert size={12} />
          <span style={{ flex: 1 }}>{printer.detail ?? PRINTER_STATE_LABEL[printer.state]}</span>
          <button
            className="btn btn-soft"
            style={{ height: 20, padding: '0 8px', fontSize: 11 }}
            onClick={(e) => {
              e.stopPropagation()
              api.printerAction(printer.id, 'fix')
            }}
          >
            <IcoWrench size={11} />
            Устранить
          </button>
        </div>
      )}

      <div className="col-body" ref={bodyRef}>
        <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              printerRunning={printer.state === 'printing' && !printer.paused}
              onPreview={onPreview}
              selected={selection.has(job.id)}
              onSelect={onSelectJob}
              onMenu={onMenuJob}
            />
          ))}
        </SortableContext>
        {jobs.length === 0 && (
          <button className="empty" onClick={onAdd}>
            Пусто · добавить файлы
          </button>
        )}
      </div>

      {grid && (overflow > 0 || expanded) && (
        <button
          className={`col-more${expanded ? ' up' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          <IcoChevronDown size={12} />
          {expanded ? 'Свернуть' : `Ещё ${overflow}`}
        </button>
      )}

      <div className="col-foot">
        <span>
          {open.length} в очереди{errors.length ? ` · ${errors.length} сбой` : ''}
        </span>
        <span>{remaining > 0 ? eta(seconds) : '—'}</span>
      </div>
    </motion.div>
  )
}
