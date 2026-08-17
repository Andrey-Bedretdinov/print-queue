import { useEffect, useState } from 'react'
import type { Theme } from '../../shared/types'
import { api } from '../lib/api'

const THEME_TIP: Record<Theme, string> = {
  light: 'Тёмная тема',
  dark: 'Розовая тема',
  pink: 'Светлая тема',
}
import {
  IcoBell,
  IcoHeart,
  IcoClose,
  IcoMax,
  IcoMin,
  IcoMoon,
  IcoMute,
  IcoSound,
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
  theme: Theme
  onTheme: () => void
  sound: boolean
  onSound: () => void
}

export function TitleBar({
  query,
  onQuery,
  alerts,
  onAlerts,
  theme,
  onTheme,
  sound,
  onSound,
}: Props) {
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

      {/* Значок показывает, что будет по нажатию: светлая → тёмная → розовая */}
      <button
        className={`icon-btn tip${theme === 'pink' ? ' on' : ''}`}
        data-tip={THEME_TIP[theme]}
        onClick={onTheme}
      >
        {theme === 'light' ? (
          <IcoMoon size={14} />
        ) : theme === 'dark' ? (
          <IcoHeart size={14} />
        ) : (
          <IcoSun size={14} />
        )}
      </button>

      <button
        className={`icon-btn tip${sound ? ' on' : ''}`}
        data-tip={sound ? 'Звук при печати' : 'Звук выключен'}
        onClick={onSound}
      >
        {sound ? <IcoSound size={14} /> : <IcoMute size={14} />}
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
