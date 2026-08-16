import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Printer } from '../../shared/types'
import { IcoEye, IcoPause, IcoRetry, IcoX } from './icons'

export interface MenuTarget {
  x: number
  y: number
  jobIds: string[]
  printerId: string
  canPreview: boolean
  canPause: boolean
  canRetry: boolean
}

interface Props {
  target: MenuTarget
  printers: Printer[]
  onMove: (printerId: string) => void
  onPreview: () => void
  onPause: () => void
  onRetry: () => void
  onCancel: () => void
  onClose: () => void
}

export function ContextMenu({
  target,
  printers,
  onMove,
  onPreview,
  onPause,
  onRetry,
  onCancel,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: target.x, y: target.y })
  const many = target.jobIds.length

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(target.x, window.innerWidth - r.width - 6),
      y: Math.min(target.y, window.innerHeight - r.height - 6),
    })
  }, [target.x, target.y])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const id = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <motion.div
      ref={ref}
      className="menu"
      style={{ left: pos.x, top: pos.y }}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="menu-label">
        {many > 1 ? `${many} задания` : 'Переложить в очередь'}
      </div>
      {printers.map((p) => (
        <button
          key={p.id}
          className="menu-item"
          disabled={p.id === target.printerId && many === 1}
          onClick={() => onMove(p.id)}
        >
          <span className={`led ${p.state}`} />
          <span className="menu-text">{p.name}</span>
          {p.id === target.printerId && <span className="menu-hint">здесь</span>}
        </button>
      ))}

      <div className="menu-sep" />
      {target.canPreview && (
        <button className="menu-item" onClick={onPreview}>
          <IcoEye size={12} />
          <span className="menu-text">Предпросмотр</span>
        </button>
      )}
      {target.canRetry && (
        <button className="menu-item" onClick={onRetry}>
          <IcoRetry size={12} />
          <span className="menu-text">Повторить</span>
        </button>
      )}
      {target.canPause && (
        <button className="menu-item" onClick={onPause}>
          <IcoPause size={12} />
          <span className="menu-text">Пауза</span>
        </button>
      )}
      <button className="menu-item danger" onClick={onCancel}>
        <IcoX size={12} />
        <span className="menu-text">Отменить</span>
      </button>
    </motion.div>
  )
}
