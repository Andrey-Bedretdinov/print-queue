import { AnimatePresence, motion } from 'framer-motion'
import type { ToastMessage } from '../../shared/ipc'
import { IcoX } from './icons'

interface Props {
  items: ToastMessage[]
  onClose: (id: string) => void
}

export function Toasts({ items, onClose }: Props) {
  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast ${t.kind}`}
            initial={{ opacity: 0, x: 24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <span className="bar" />
            <span className="toast-main">
              <b>{t.text}</b>
              {t.sub && <i>{t.sub}</i>}
            </span>
            <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={() => onClose(t.id)}>
              <IcoX size={10} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
