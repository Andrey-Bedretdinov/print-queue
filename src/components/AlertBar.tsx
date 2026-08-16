import { motion } from 'framer-motion'
import type { Incident } from '../../shared/types'
import { IcoAlert, IcoX } from './icons'

interface Props {
  incidents: Incident[]
  onOpen: () => void
  onDismissAll: () => void
}

export function AlertBar({ incidents, onOpen, onDismissAll }: Props) {
  return (
    <motion.div
      className="alert-bar"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 30, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <IcoAlert size={13} />
      <b style={{ fontWeight: 500 }}>{incidents.length}</b>
      <span className="names">{incidents.map((i) => i.jobName).join(' · ')}</span>
      <button className="chip" style={{ height: 20, color: 'var(--err)' }} onClick={onOpen}>
        Показать
      </button>
      <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={onDismissAll}>
        <IcoX size={11} />
      </button>
    </motion.div>
  )
}
