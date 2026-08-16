import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Incident, Printer } from '../../shared/types'
import { FAILURE_LABEL } from '../../shared/types'
import { api } from '../lib/api'
import { ago } from '../lib/format'
import { IcoAlert, IcoCheck, IcoEye, IcoRetry, IcoTrash, IcoX } from './icons'

interface Props {
  incidents: Incident[]
  printers: Printer[]
  onClose: () => void
  onPreview: (incident: Incident) => void
}

export function Incidents({ incidents, printers, onClose, onPreview }: Props) {
  const [menu, setMenu] = useState<string | null>(null)
  const active = incidents.filter((i) => !i.resolved && !i.dismissed)
  const hidden = incidents.filter((i) => !i.resolved && i.dismissed)
  const resolved = incidents.filter((i) => i.resolved).slice(0, 12)

  return (
    <motion.div
      className="drawer"
      initial={{ x: 340, opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0.4 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <div className="drawer-head">
        <IcoAlert size={13} />
        <span style={{ flex: 1 }}>Сбои печати</span>
        {active.length > 0 && (
          <button className="chip" onClick={() => api.incident('dismiss-all')}>
            Скрыть все
          </button>
        )}
        <button className="icon-btn" onClick={onClose}>
          <IcoX size={13} />
        </button>
      </div>

      <div className="drawer-body">
        <AnimatePresence initial={false}>
          {active.map((inc) => (
            <Row
              key={inc.id}
              inc={inc}
              printers={printers}
              menu={menu === inc.id}
              onMenu={() => setMenu((v) => (v === inc.id ? null : inc.id))}
              onPreview={onPreview}
            />
          ))}
        </AnimatePresence>

        {active.length === 0 && (
          <div className="blank" style={{ padding: '24px 0' }}>
            <IcoCheck size={20} />
            Сбоев нет
          </div>
        )}

        {hidden.length > 0 && (
          <>
            <div className="section-label">Скрытые · {hidden.length}</div>
            {hidden.map((inc) => (
              <Row
                key={inc.id}
                inc={inc}
                printers={printers}
                menu={menu === inc.id}
                onMenu={() => setMenu((v) => (v === inc.id ? null : inc.id))}
                onPreview={onPreview}
                muted
              />
            ))}
          </>
        )}

        {resolved.length > 0 && (
          <>
            <div className="section-label">Устранены</div>
            {resolved.map((inc) => (
              <div className="inc done" key={inc.id}>
                <span className="inc-icon">
                  <IcoCheck size={13} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <div className="inc-name">{inc.jobName}</div>
                  <div className="inc-sub">
                    Напечатано на «{inc.resolvedPrinterName ?? inc.printerName}» ·{' '}
                    {ago(inc.resolvedAt ?? inc.at)} назад
                  </div>
                </span>
                <span className="inc-acts">
                  <button className="icon-btn" onClick={() => api.incident('forget', inc.id)}>
                    <IcoTrash size={12} />
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </motion.div>
  )
}

interface RowProps {
  inc: Incident
  printers: Printer[]
  menu: boolean
  onMenu: () => void
  onPreview: (incident: Incident) => void
  muted?: boolean
}

function Row({ inc, printers, menu, onMenu, onPreview, muted }: RowProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: muted ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: -4 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      className="inc"
    >
      <span className="inc-icon">
        <IcoAlert size={13} />
      </span>
      <span style={{ minWidth: 0 }}>
        <div className="inc-name">{inc.jobName}</div>
        <div className="inc-sub">
          {FAILURE_LABEL[inc.failure]} · «{inc.printerName}» · {ago(inc.at)} назад
        </div>
        <AnimatePresence>
          {menu && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="section-label" style={{ padding: '6px 0 2px' }}>
                Перепечатать на
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {printers.map((p) => (
                  <button
                    key={p.id}
                    className="chip"
                    style={{ height: 20, background: 'var(--surface)' }}
                    onClick={() => api.incident('reprint', inc.id, p.id)}
                  >
                    <span className={`led ${p.state}`} style={{ width: 6, height: 6 }} />
                    {p.name.length > 18 ? `${p.name.slice(0, 18)}…` : p.name}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </span>
      <span className="inc-acts">
        {inc.path && (
          <button className="icon-btn tip" data-tip="Просмотр" onClick={() => onPreview(inc)}>
            <IcoEye size={12} />
          </button>
        )}
        <button className="icon-btn tip" data-tip="Перепечатать" onClick={onMenu}>
          <IcoRetry size={12} />
        </button>
        <button
          className="icon-btn tip"
          data-tip={muted ? 'Удалить' : 'Скрыть'}
          onClick={() => api.incident(muted ? 'forget' : 'dismiss', inc.id)}
        >
          <IcoX size={12} />
        </button>
      </span>
    </motion.div>
  )
}
