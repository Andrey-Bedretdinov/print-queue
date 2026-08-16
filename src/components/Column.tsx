import { useState } from 'react'
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
  onSelect: (id: string) => void
  onPreview: (job: Job) => void
  onDropFiles: (paths: string[], printerId: string) => void
  onAdd: () => void
}

export function Column({
  column,
  dragKind,
  dragging,
  dropTarget,
  selected,
  onSelect,
  onPreview,
  onDropFiles,
  onAdd,
}: Props) {
  const { printer, jobs } = column
  const { setNodeRef, isOver } = useDroppable({ id: `col:${printer.id}` })
  const handle = useDraggable({ id: `pcol:${printer.id}`, disabled: dragKind === 'job' })
  const [fileOver, setFileOver] = useState(false)

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
        (dragging ? ' lifted' : '')
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
          </i>
        </span>
        <span className="col-actions">
          <button
            className="icon-btn tip"
            data-tip="Добавить"
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

      <div className="col-body">
        <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} onPreview={onPreview} />
          ))}
        </SortableContext>
        {jobs.length === 0 && <div className="empty">Пусто</div>}
      </div>

      <div className="col-foot">
        <span>
          {open.length} в очереди{errors.length ? ` · ${errors.length} сбой` : ''}
        </span>
        <span>{remaining > 0 ? eta(seconds) : '—'}</span>
      </div>
    </motion.div>
  )
}
