import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import type { ConnectionKind, Printer } from '../../shared/types'
import { IcoCheck, IcoNet, IcoPrinter, IcoUsb } from './icons'

interface Props {
  printers: Printer[]
  hidden: string[]
  onToggle: (id: string) => void
  onAll: (visible: boolean) => void
  onPrepare: () => void
  onClose: () => void
}

const GROUPS: Array<[ConnectionKind, string]> = [
  ['network', 'Сеть'],
  ['usb', 'USB'],
  ['virtual', 'Виртуальные'],
]

const ICON: Record<ConnectionKind, React.ReactNode> = {
  network: <IcoNet size={11} />,
  usb: <IcoUsb size={11} />,
  virtual: <IcoPrinter size={11} />,
}

export function PrinterPicker({ printers, hidden, onToggle, onAll, onPrepare, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Deferred so the click that opened the popover does not close it again.
    const id = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const shown = printers.length - hidden.length

  return (
    <motion.div
      ref={ref}
      className="popover"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <div className="popover-head">
        <span style={{ flex: 1 }}>Показывать</span>
        <button className="chip" style={{ height: 20 }} onClick={() => onAll(true)}>
          Все
        </button>
        <button className="chip" style={{ height: 20 }} onClick={() => onAll(false)}>
          Ничего
        </button>
      </div>

      <div className="popover-body">
        {GROUPS.map(([kind, label]) => {
          const items = printers.filter((p) => p.connection === kind)
          if (!items.length) return null
          return (
            <div key={kind}>
              <div className="rail-group">
                {ICON[kind]}
                <span>{label}</span>
              </div>
              {items.map((p) => {
                const on = !hidden.includes(p.id)
                return (
                  <button key={p.id} className="pick-item" onClick={() => onToggle(p.id)}>
                    <span className={`check${on ? ' on' : ''}`}>{on && <IcoCheck size={10} />}</span>
                    <span className={`led ${p.state}`} />
                    <span className="pick-name">
                      <b>{p.name}</b>
                      <i>{p.address}</i>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="popover-foot">
        <span>
          {shown} из {printers.length}
        </span>
        <button className="chip" style={{ height: 20 }} onClick={onPrepare}>
          Разрешить перенос у всех
        </button>
      </div>
    </motion.div>
  )
}
