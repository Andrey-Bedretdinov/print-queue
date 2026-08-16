import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import {
  IcoBell,
  IcoClose,
  IcoMax,
  IcoMin,
  IcoMoon,
  IcoPrinter,
  IcoSearch,
  IcoSun,
  IcoX,
} from './icons'

interface Props {
  query: string
  onQuery: (value: string) => void
  alerts: number
  onAlerts: () => void
  theme: 'light' | 'dark'
  onTheme: () => void
}

export function TitleBar({ query, onQuery, alerts, onAlerts, theme, onTheme }: Props) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => api.onWindowState(setMaximized), [])

  return (
    <div className="chrome">
      <div className="brand">
        <div className="brand-mark">
          <IcoPrinter size={11} />
        </div>
        <div className="brand-text">Очередь печати</div>
      </div>

      <div className="chrome-spacer" />

      <label className="search">
        <IcoSearch size={12} />
        <input
          value={query}
          placeholder="Поиск"
          onChange={(e) => onQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button className="icon-btn" style={{ width: 16, height: 16 }} onClick={() => onQuery('')}>
            <IcoX size={10} />
          </button>
        )}
      </label>

      <button
        className={`icon-btn tip${alerts ? ' danger' : ''}`}
        data-tip="Предупреждения"
        onClick={onAlerts}
        style={{ position: 'relative', color: alerts ? 'var(--err)' : undefined }}
      >
        <IcoBell size={14} />
        {alerts > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 1,
              right: 1,
              minWidth: 12,
              height: 12,
              padding: '0 3px',
              borderRadius: 6,
              background: 'var(--err)',
              color: '#fff',
              fontSize: 9,
              lineHeight: '12px',
              textAlign: 'center',
            }}
          >
            {alerts}
          </span>
        )}
      </button>

      <button className="icon-btn tip" data-tip="Тема" onClick={onTheme}>
        {theme === 'dark' ? <IcoSun size={14} /> : <IcoMoon size={14} />}
      </button>

      <div className="win-btns">
        <button className="win-btn" onClick={() => api.window('minimize')}>
          <IcoMin />
        </button>
        <button className="win-btn" onClick={() => api.window('maximize')}>
          <IcoMax size={maximized ? 9 : 10} />
        </button>
        <button className="win-btn close" onClick={() => api.window('close')}>
          <IcoClose />
        </button>
      </div>
    </div>
  )
}
