import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Job, PreviewPayload } from '../../shared/types'
import { api } from '../lib/api'
import { bytes, pages } from '../lib/format'
import { IcoExternal, IcoX } from './icons'

interface Props {
  job: Job
  onClose: () => void
}

export function PreviewModal({ job, onClose }: Props) {
  const [data, setData] = useState<PreviewPayload | null>(null)
  const [fit, setFit] = useState(true)

  useEffect(() => {
    let alive = true
    setData(null)
    if (!job.path) {
      setData({
        kind: 'none',
        name: job.name,
        ext: job.ext,
        bytes: job.bytes,
        pages: job.pages,
        note: 'Файл задания недоступен — Windows не отдаёт содержимое чужих заданий',
      })
      return
    }
    api.preview(job.path).then((p) => {
      if (alive) setData(p)
    })
    return () => {
      alive = false
    }
  }, [job.path, job.name, job.ext, job.bytes, job.pages])

  return (
    <motion.div
      className="backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="modal"
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <div className="modal-head">
          <span className="modal-title">
            <b>{data?.name ?? job.name}</b>
            <i>
              {pages(data?.pages ?? job.pages)} · {bytes(data?.bytes ?? job.bytes)}
              {data?.path ? ` · ${data.path}` : ''}
            </i>
          </span>
          {data?.kind === 'image' && (
            <button className="chip" onClick={() => setFit((v) => !v)}>
              {fit ? '100%' : 'По размеру'}
            </button>
          )}
          {data?.path && (
            <button
              className="icon-btn tip"
              data-tip="Открыть в системе"
              onClick={() => api.openExternal(data.path!)}
            >
              <IcoExternal size={14} />
            </button>
          )}
          <button className="icon-btn" onClick={onClose}>
            <IcoX size={14} />
          </button>
        </div>

        <div className="modal-body">
          {!data && <div className="blank">Загрузка…</div>}
          {data?.kind === 'image' && (
            <img
              src={data.url}
              alt={data.name}
              style={fit ? undefined : { maxWidth: 'none', maxHeight: 'none' }}
            />
          )}
          {data?.kind === 'pdf' && <iframe src={`${data.url}#toolbar=1&view=FitH`} title={data.name} />}
          {data?.kind === 'text' && <pre>{data.text}</pre>}
          {data?.kind === 'none' && (
            <div className="blank">
              <span
                className="ftype"
                style={{ width: 44, height: 44, fontSize: 12, background: 'var(--stroke)' }}
              >
                {data.ext || '?'}
              </span>
              <span>{data.note}</span>
              {data.path && (
                <button className="btn btn-soft" onClick={() => api.openExternal(data.path!)}>
                  <IcoExternal size={12} />
                  Открыть
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
