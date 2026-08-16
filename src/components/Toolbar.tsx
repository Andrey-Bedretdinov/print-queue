import type { ReactNode } from 'react'
import type { Settings } from '../../shared/types'
import { IcoList, IcoPlus, IcoRail } from './icons'

export type Filter = 'all' | 'active' | 'error'

interface Props {
  filter: Filter
  onFilter: (value: Filter) => void
  totals: { printers: number; queued: number; errors: number; hidden: number }
  settings: Settings
  systemAvailable: boolean
  pickerOpen: boolean
  onAdd: () => void
  onPicker: () => void
  onToggleSim: () => void
  onToggleRail: () => void
  children?: ReactNode
}

const FILTERS: Array<[Filter, string]> = [
  ['all', 'Все'],
  ['active', 'В работе'],
  ['error', 'Сбои'],
]

export function Toolbar({
  filter,
  onFilter,
  totals,
  settings,
  systemAvailable,
  pickerOpen,
  onAdd,
  onPicker,
  onToggleSim,
  onToggleRail,
  children,
}: Props) {
  return (
    <div className="toolbar">
      <button className="icon-btn tip" data-tip="Панель принтеров" onClick={onToggleRail}>
        <IcoRail size={14} />
      </button>
      <div style={{ position: 'relative' }}>
        <button
          className={`icon-btn tip${pickerOpen ? ' on' : ''}`}
          data-tip="Какие принтеры показывать"
          onClick={onPicker}
        >
          <IcoList size={14} />
        </button>
        {children}
      </div>
      <div className="divider" />
      <button className="btn btn-primary" onClick={onAdd}>
        <IcoPlus size={12} />
        Файлы
      </button>
      <div className="divider" />
      {FILTERS.map(([value, label]) => (
        <button
          key={value}
          className={`chip${filter === value ? ' on' : ''}`}
          onClick={() => onFilter(value)}
        >
          {label}
          {value === 'error' && totals.errors > 0 && <span className="num">{totals.errors}</span>}
          {value === 'active' && totals.queued > 0 && <span className="num">{totals.queued}</span>}
        </button>
      ))}

      <div className="toolbar-right">
        <div className="counters">
          <span>
            <b>{totals.printers}</b> принтеров
          </span>
          {totals.hidden > 0 && <span>{totals.hidden} скрыто</span>}
          <span>
            <b>{totals.queued}</b> в очереди
          </span>
          {totals.errors > 0 && (
            <span style={{ color: 'var(--err)' }}>
              <b style={{ color: 'var(--err)' }}>{totals.errors}</b> сбоев
            </span>
          )}
        </div>
        <div className="divider" />
        <button
          className="chip tip"
          data-tip={systemAvailable ? 'Виртуальные принтеры' : 'Спулер недоступен'}
          onClick={onToggleSim}
        >
          <span className={`switch${settings.simulation ? ' on' : ''}`} />
          Эмуляция
        </button>
      </div>
    </div>
  )
}
