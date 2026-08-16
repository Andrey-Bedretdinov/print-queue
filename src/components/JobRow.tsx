import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Job } from '../../shared/types'
import { FAILURE_LABEL } from '../../shared/types'
import { api } from '../lib/api'
import { bytes, clock, pages, typeColor, typeLabel } from '../lib/format'
import { IcoAlert, IcoCheck, IcoEye, IcoPause, IcoPlay, IcoRetry, IcoTop, IcoX } from './icons'

interface Props {
  job: Job
  onPreview?: (job: Job) => void
  overlay?: boolean
  selected?: boolean
  onSelect?: (job: Job, e: React.MouseEvent) => void
  onMenu?: (job: Job, e: React.MouseEvent) => void
}

export function JobRow({ job, onPreview, overlay, selected, onSelect, onMenu }: Props) {
  const sortable = useSortable({ id: job.id, disabled: overlay })
  const total = job.pages * job.copies
  const percent = total > 0 ? Math.min(100, (job.printedPages / total) * 100) : 0
  const done = job.state === 'completed'

  const style = overlay
    ? undefined
    : { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }

  const act = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation()
      fn()
    },
  })

  return (
    <div
      ref={overlay ? undefined : sortable.setNodeRef}
      style={style}
      className={`job ${job.state}${sortable.isDragging && !overlay ? ' ghost' : ''}${overlay ? ' drag' : ''}${selected ? ' sel' : ''}`}
      {...(overlay ? {} : sortable.attributes)}
      {...(overlay ? {} : sortable.listeners)}
      onClick={(e) => onSelect?.(job, e)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onMenu?.(job, e)
      }}
      onDoubleClick={() => job.path && onPreview?.(job)}
      title={`${job.name} · ${pages(total)} · ${bytes(job.bytes)}`}
    >
      <span className="ftype" style={{ background: typeColor(job.ext) }}>
        {typeLabel(job.ext)}
      </span>

      <span className="job-name">
        {job.state === 'error' && <IcoAlert size={10} />}
        {done && <IcoCheck size={10} />}
        {job.name}
      </span>

      <span className="job-tail">
        <span className="job-meta">
          {job.state === 'error' ? (
            <span className="err">{FAILURE_LABEL[job.failure ?? 'driver_error']}</span>
          ) : job.state === 'printing' ? (
            <span style={{ color: 'var(--primary)' }}>
              {Math.min(total, Math.round(job.printedPages))}/{total} · {Math.round(percent)}%
            </span>
          ) : done ? (
            <span className="ok">{clock(job.finishedAt)}</span>
          ) : job.state === 'paused' ? (
            <span>пауза</span>
          ) : (
            <span>
              {total} с. · {bytes(job.bytes)}
            </span>
          )}
          {job.movedFrom && <span title="Перенесено">↦</span>}
          {job.source === 'system' && <span title="Задание Windows">sys</span>}
        </span>

        <span className="job-acts">
          {job.path && (
            <button className="icon-btn tip" data-tip="Предпросмотр" {...act(() => onPreview?.(job))}>
              <IcoEye size={12} />
            </button>
          )}
          {job.state === 'error' && job.source === 'sim' && (
            <button
              className="icon-btn tip"
              data-tip="Повторить"
              {...act(() => api.jobAction(job.id, 'retry'))}
            >
              <IcoRetry size={12} />
            </button>
          )}
          {job.state === 'queued' && (
            <button
              className="icon-btn tip"
              data-tip="В начало"
              {...act(() => api.jobAction(job.id, 'top'))}
            >
              <IcoTop size={12} />
            </button>
          )}
          {(job.state === 'queued' || job.state === 'printing') && (
            <button
              className="icon-btn tip"
              data-tip="Пауза"
              {...act(() => api.jobAction(job.id, 'pause'))}
            >
              <IcoPause size={12} />
            </button>
          )}
          {job.state === 'paused' && (
            <button
              className="icon-btn tip"
              data-tip="Продолжить"
              {...act(() => api.jobAction(job.id, 'resume'))}
            >
              <IcoPlay size={12} />
            </button>
          )}
          {!done && (
            <button
              className="icon-btn danger tip"
              data-tip="Отменить"
              {...act(() => api.jobAction(job.id, 'cancel'))}
            >
              <IcoX size={12} />
            </button>
          )}
        </span>
      </span>

      {job.state === 'printing' && (
        <span className="progress">
          <i style={{ width: `${percent}%` }} />
        </span>
      )}
    </div>
  )
}
