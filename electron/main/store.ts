import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Incident, Settings } from '../../shared/types'

interface Bounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

interface Persisted {
  settings: Settings
  incidents: Incident[]
  order: Record<string, string[]>
  bounds: Bounds
}

const DEFAULTS: Persisted = {
  settings: {
    theme: 'light',
    simulation: false,
    pollMs: 1200,
    railCollapsed: false,
    compact: false,
    hidden: [],
    order: [],
    layout: 'board',
    cardHeight: 240,
    cardAuto: true,
    prepared: [],
  },
  incidents: [],
  order: {},
  bounds: { width: 1180, height: 720 },
}

let file = ''
let data: Persisted = structuredClone(DEFAULTS)
let flushTimer: NodeJS.Timeout | null = null

export function initStore() {
  file = join(app.getPath('userData'), 'state.json')
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Persisted>
      data = {
        settings: { ...DEFAULTS.settings, ...(raw.settings ?? {}) },
        incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
        order: raw.order ?? {},
        bounds: { ...DEFAULTS.bounds, ...(raw.bounds ?? {}) },
      }
    }
  } catch {
    data = structuredClone(DEFAULTS)
  }
}

export const store = {
  get settings() {
    return data.settings
  },
  get incidents() {
    return data.incidents
  },
  set incidents(next: Incident[]) {
    data.incidents = next
    flush()
  },
  get bounds() {
    return data.bounds
  },
  setBounds(next: Bounds) {
    data.bounds = next
    flush()
  },
  patchSettings(patch: Partial<Settings>) {
    data.settings = { ...data.settings, ...patch }
    flush()
    return data.settings
  },
  flush,
}

/** Debounced write — the queue mutates often and the file is tiny. */
function flush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    } catch {
      /* a lost settings write must never take the app down */
    }
  }, 400)
}
