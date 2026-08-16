import { useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { ConnectionKind, Printer } from '../../shared/types'
import type { ColumnView } from '../App'
import { hasFiles, pathsFrom } from '../lib/files'
import { IcoNet, IcoPrinter, IcoUsb } from './icons'

interface Props {
  columns: ColumnView[]
  collapsed: boolean
  selected: string | null
  onSelect: (id: string) => void
  onDropFiles: (paths: string[], printerId: string) => void
}

const GROUPS: Array<[ConnectionKind, string, ReactNode]> = [
  ['network', 'Сеть', <IcoNet size={11} key="n" />],
  ['usb', 'USB', <IcoUsb size={11} key="u" />],
  ['virtual', 'Виртуальные', <IcoPrinter size={11} key="v" />],
]

export function Rail({ columns, collapsed, selected, onSelect, onDropFiles }: Props) {
  return (
    <div className={`rail${collapsed ? ' collapsed' : ''}`}>
      <div className="rail-scroll">
        {GROUPS.map(([kind, label, icon]) => {
          const items = columns.filter((c) => c.printer.connection === kind)
          if (!items.length) return null
          return (
            <div key={kind}>
              <div className="rail-group">
                {icon}
                <span>{label}</span>
              </div>
              {items.map((col) => (
                <RailItem
                  key={col.printer.id}
                  printer={col.printer}
                  count={col.jobs.filter((j) => j.state !== 'completed').length}
                  errors={col.jobs.filter((j) => j.state === 'error').length}
                  selected={selected === col.printer.id}
                  collapsed={collapsed}
                  onSelect={onSelect}
                  onDropFiles={onDropFiles}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ItemProps {
  printer: Printer
  count: number
  errors: number
  selected: boolean
  collapsed: boolean
  onSelect: (id: string) => void
  onDropFiles: (paths: string[], printerId: string) => void
}

function RailItem({ printer, count, errors, selected, collapsed, onSelect, onDropFiles }: ItemProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `rail:${printer.id}` })
  const [fileOver, setFileOver] = useState(false)

  return (
    <button
      ref={setNodeRef}
      className={`rail-item${selected ? ' sel' : ''}${isOver || fileOver ? ' drop' : ''}`}
      onClick={() => onSelect(printer.id)}
      title={collapsed ? `${printer.name} · ${printer.address}` : undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setFileOver(true)
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setFileOver(false)
        onDropFiles(pathsFrom(e), printer.id)
      }}
    >
      <span className={`led ${printer.state}`} />
      <span className="rail-name">
        <b>{printer.name}</b>
        <i>{printer.detail ?? printer.address}</i>
        {printer.consumables.length > 0 && (
          <span className="ink">
            {printer.consumables.map((c) => (
              <span key={c.id} title={`${c.label} ${Math.round(c.level)}%`}>
                <i
                  style={{
                    width: `${Math.max(2, Math.round(c.level))}%`,
                    background: c.level < 10 ? 'var(--err)' : c.color,
                  }}
                />
              </span>
            ))}
          </span>
        )}
      </span>
      {count > 0 && <span className={`badge${errors ? ' red' : ' blue'}`}>{count}</span>}
    </button>
  )
}
