import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { Settings } from '../../shared/types'
import { api } from '../lib/api'
import { IcoBoard, IcoGrid, IcoList, IcoMinus, IcoPlus, IcoRail, IcoRetry, IcoShield, IcoExternal } from './icons'

export type Filter = 'all' | 'active' | 'error'

interface Props {
  filter: Filter
  onFilter: (value: Filter) => void
  totals: { printers: number; queued: number; errors: number; hidden: number }
  settings: Settings
  systemAvailable: boolean
  version: string
  needsAdmin: boolean
  pickerOpen: boolean
  onElevate: () => void
  onPicker: () => void
  onToggleSim: () => void
  onToggleRail: () => void
  cardHeight: number
  onLayout: (value: 'board' | 'grid') => void
  onCardHeight: (value: number) => void
  onCardAuto: () => void
  children?: ReactNode
}

export const CARD_MIN = 140
export const CARD_MAX = 640
const CARD_STEP = 40

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
  version,
  needsAdmin,
  pickerOpen,
  onElevate,
  onPicker,
  onToggleSim,
  onToggleRail,
  cardHeight,
  onLayout,
  onCardHeight,
  onCardAuto,
  children,
}: Props) {
  const grid = settings.layout === 'grid'
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
      <span className="seg">
        <button
          className={`icon-btn tip${grid ? '' : ' on'}`}
          data-tip="Колонки"
          onClick={() => onLayout('board')}
        >
          <IcoBoard size={14} />
        </button>
        <button
          className={`icon-btn tip${grid ? ' on' : ''}`}
          data-tip="Сетка по окну"
          onClick={() => onLayout('grid')}
        >
          <IcoGrid size={14} />
        </button>
      </span>
      {grid && (
        <span className="stepper">
          <button
            className="icon-btn"
            disabled={!settings.cardAuto && cardHeight <= CARD_MIN}
            onClick={() => onCardHeight(Math.max(CARD_MIN, cardHeight - CARD_STEP))}
          >
            <IcoMinus size={12} />
          </button>
          <b>{cardHeight}</b>
          <button
            className="icon-btn"
            disabled={!settings.cardAuto && cardHeight >= CARD_MAX}
            onClick={() => onCardHeight(Math.min(CARD_MAX, cardHeight + CARD_STEP))}
          >
            <IcoPlus size={12} />
          </button>
          <button
            className={`chip tip${settings.cardAuto ? ' on' : ''}`}
            data-tip="Подгонять под окно"
            style={{ height: 18, padding: '0 6px', fontSize: 10 }}
            onClick={onCardAuto}
          >
            Авто
          </button>
        </span>
      )}
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
        {needsAdmin && (
          <button className="chip warn tip" data-tip="Перезапустить с правами" onClick={onElevate}>
            <IcoShield size={12} />
            Перенос без прав администратора
          </button>
        )}
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
        <VersionMenu version={version} />
      </div>
    </div>
  )
}

/**
 * Версия в углу — заодно и точка входа к обновлению. Отдельной кнопки для него
 * в окне не завести: место в панели кончилось, а искать её человеку всё равно
 * негде — версия единственное, на что он смотрит, проверяя «обновилось или
 * нет». Журнал переносов, который раньше открывался кликом, переехал сюда же.
 */
function VersionMenu({ version }: { version: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!open) return
    const a = anchor.current?.getBoundingClientRect()
    const el = ref.current
    if (!a || !el) return
    // offsetWidth, а не getBoundingClientRect: меню появляется с анимацией
    // масштаба, и в первый кадр прямоугольник приходит уменьшенным — меню
    // вставало на пару пикселей правее кнопки.
    const width = el.offsetWidth
    setPos({
      x: Math.max(6, Math.min(a.right - width, window.innerWidth - width - 6)),
      y: a.bottom + 4,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const id = setTimeout(() => document.addEventListener('mousedown', away), 0)
    document.addEventListener('keydown', esc)
    window.addEventListener('blur', close)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('blur', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={anchor}
        className="version"
        title="Версия приложения"
        onClick={() => setOpen((v) => !v)}
      >
        {version}
      </button>
      {open && (
        <motion.div
          ref={ref}
          className="menu"
          style={{ left: pos.x, top: pos.y }}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              void api.updateNow()
            }}
          >
            <IcoRetry size={12} />
            <span className="menu-text">Обновить</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              void api.openLog()
            }}
          >
            <IcoExternal size={12} />
            <span className="menu-text">Лог</span>
          </button>
        </motion.div>
      )}
    </>
  )
}
