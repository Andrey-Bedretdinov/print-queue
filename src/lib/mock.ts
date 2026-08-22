/**
 * Browser-only stand-in for the Electron bridge. It exists so the renderer can
 * be opened in a plain browser during UI work; inside Electron `window.pq` is
 * always present and none of this runs.
 */
import type { AppState, Incident, Job, Printer, Settings } from '../../shared/types'
import type { ToastMessage } from '../../shared/ipc'
import type { PqApi } from '../../electron/preload/index'

const printer = (p: Partial<Printer> & Pick<Printer, 'id' | 'name'>): Printer => ({
  model: p.name,
  connection: 'network',
  address: '192.168.0.1',
  state: 'ready',
  source: 'sim',
  paused: false,
  default: false,
  color: false,
  duplex: true,
  consumables: [],
  tray: 300,
  speed: 30,
  ...p,
})

const printers: Printer[] = [
  printer({
    id: 'sim:hp-m404',
    name: 'HP LaserJet Pro M404dn',
    address: '192.168.0.51',
    consumables: [{ id: 'k', label: 'Тонер', level: 64, color: '#4b4b4b' }],
    speed: 38,
  }),
  printer({
    id: 'sim:canon-ts8340',
    name: 'Canon PIXMA TS8340',
    connection: 'usb',
    address: 'USB001',
    color: true,
    consumables: [
      { id: 'c', label: 'C', level: 71, color: '#00a3c8' },
      { id: 'm', label: 'M', level: 44, color: '#d6489a' },
      { id: 'y', label: 'Y', level: 82, color: '#e8b93a' },
      { id: 'k', label: 'K', level: 23, color: '#4b4b4b' },
    ],
    speed: 15,
  }),
  printer({
    id: 'sim:kyocera-p3145',
    name: 'Kyocera ECOSYS P3145dn',
    address: '192.168.0.77',
    state: 'error',
    detail: 'Замятие бумаги',
    consumables: [{ id: 'k', label: 'Тонер', level: 9, color: '#4b4b4b' }],
    speed: 45,
  }),
  printer({
    id: 'sim:zebra-zd421',
    name: 'Zebra ZD421',
    connection: 'usb',
    address: 'USB003',
    consumables: [{ id: 'r', label: 'Лента', level: 37, color: '#4b4b4b' }],
    speed: 60,
  }),
  printer({
    id: 'sys:hp_m283',
    name: 'HP Color LaserJet MFP M283fdw',
    connection: 'network',
    address: '192.168.0.108',
    source: 'system',
    state: 'warning',
    detail: 'Мало тонера',
    color: true,
    speed: 21,
  }),
]

let n = 0
const job = (p: Partial<Job> & Pick<Job, 'printerId' | 'name' | 'pages'>): Job => ({
  id: `mock${++n}`,
  ext: p.name.split('.').pop() ?? '',
  path: `C:/samples/${p.name}`,
  bytes: 40_000 + n * 130_000,
  printedPages: 0,
  copies: 1,
  owner: 'Вы',
  state: 'queued',
  submittedAt: Date.now() - n * 60_000,
  signature: `sig${n}`,
  source: 'sim',
  retries: 0,
  ...p,
})

const jobs: Job[] = [
  job({ printerId: 'sim:hp-m404', name: 'Договор аренды.pdf', pages: 6, state: 'printing', printedPages: 2.4 }),
  job({ printerId: 'sim:hp-m404', name: 'Счёт 2481.pdf', pages: 1 }),
  job({ printerId: 'sim:hp-m404', name: 'Список рассылки.txt', pages: 2 }),
  job({ printerId: 'sim:canon-ts8340', name: 'Отчёт Q3.pdf', pages: 12, state: 'printing', printedPages: 7.2 }),
  job({ printerId: 'sim:canon-ts8340', name: 'Накладная 77.pdf', pages: 2, state: 'paused' }),
  job({ printerId: 'sim:kyocera-p3145', name: 'Договор аренды.pdf', pages: 6, state: 'error', failure: 'paper_jam', printedPages: 2 }),
  job({ printerId: 'sim:kyocera-p3145', name: 'Этикетки 50x30.pdf', pages: 24 }),
  job({ printerId: 'sim:zebra-zd421', name: 'Этикетки 50x30.pdf', pages: 24, state: 'printing', printedPages: 18 }),
  job({ printerId: 'sys:hp_m283', name: 'Презентация.pptx', pages: 18, source: 'system' }),
  job({ printerId: 'sys:hp_m283', name: 'Скан 0042.jpg', pages: 1, state: 'completed', printedPages: 1, finishedAt: Date.now() - 30_000 }),
]

const incidents: Incident[] = [
  {
    id: 'inc1',
    signature: 'sig6',
    jobName: 'Договор аренды.pdf',
    ext: 'pdf',
    path: 'C:/samples/Договор аренды.pdf',
    pages: 6,
    printerId: 'sim:kyocera-p3145',
    printerName: 'Kyocera ECOSYS P3145dn',
    failure: 'paper_jam',
    at: Date.now() - 240_000,
    resolved: false,
    dismissed: false,
  },
  {
    id: 'inc2',
    signature: 'sig-old',
    jobName: 'Акт сверки.pdf',
    ext: 'pdf',
    pages: 3,
    printerId: 'sim:zebra-zd421',
    printerName: 'Zebra ZD421',
    failure: 'out_of_paper',
    at: Date.now() - 900_000,
    resolved: true,
    resolvedAt: Date.now() - 600_000,
    resolvedPrinterName: 'HP LaserJet Pro M404dn',
    dismissed: false,
  },
]

const settings: Settings = {
  theme: 'light',
  simulation: false,
  pollMs: 2500,
  railCollapsed: false,
  compact: false,
  hidden: [],
  order: [],
  layout: 'board',
  cardHeight: 240,
  cardAuto: true,
  sound: true,
  prepared: [],
}

const state: AppState = {
  printers,
  jobs,
  incidents,
  settings,
  systemAvailable: true,
  version: 'dev',
  canMoveSystem: false,
}
const listeners: Array<(s: AppState) => void> = []
const toasters: Array<(t: ToastMessage) => void> = []

const emit = () => listeners.forEach((cb) => cb({ ...state, jobs: [...state.jobs] }))

setInterval(() => {
  for (const j of state.jobs) {
    if (j.state !== 'printing') continue
    const p = printers.find((x) => x.id === j.printerId)
    j.printedPages = Math.min(j.pages * j.copies, j.printedPages + (p?.speed ?? 30) / 60 / 4)
    if (j.printedPages >= j.pages * j.copies) {
      j.state = 'completed'
      j.finishedAt = Date.now()
      const next = state.jobs.find((x) => x.printerId === j.printerId && x.state === 'queued')
      if (next) next.state = 'printing'
    }
  }
  emit()
}, 250)

export const mockApi: PqApi = {
  getState: async () => state,
  onState: (cb) => {
    listeners.push(cb)
    return () => listeners.splice(listeners.indexOf(cb), 1)  },
  onToast: (cb) => {
    toasters.push(cb)
    return () => toasters.splice(toasters.indexOf(cb), 1)  },
  onWindowState: () => () => {},
  jobAction: async (id, kind) => {
    const j = state.jobs.find((x) => x.id === id)
    if (!j) return false
    if (kind === 'cancel') state.jobs = state.jobs.filter((x) => x.id !== id)
    else if (kind === 'pause') j.state = 'paused'
    else if (kind === 'resume') j.state = 'queued'
    else if (kind === 'retry') {
      j.state = 'queued'
      j.failure = undefined
      j.printedPages = 0
    }
    emit()
    return true
  },
  moveJob: async (id, printerId, position) => {
    const idx = state.jobs.findIndex((x) => x.id === id)
    if (idx < 0) return { ok: false, reason: 'нет задания' }
    const [j] = state.jobs.splice(idx, 1)
    if (j.printerId !== printerId) {
      j.movedFrom = j.printerId
      j.printerId = printerId
      if (j.state === 'error') j.state = 'queued'
    }
    const before = state.jobs.filter((x) => x.printerId === printerId)
    const anchor = before[position]
    state.jobs.splice(anchor ? state.jobs.indexOf(anchor) : state.jobs.length, 0, j)
    emit()
    return { ok: true }
  },
  printerAction: async (id, kind) => {
    const p = printers.find((x) => x.id === id)
    if (!p) return false
    if (kind === 'pause') {
      p.paused = true
      p.state = 'paused'
    } else if (kind === 'resume') {
      p.paused = false
      p.state = 'ready'
    } else if (kind === 'fix') {
      p.state = 'ready'
      p.detail = undefined
      for (const j of state.jobs) if (j.printerId === id && j.state === 'error') j.state = 'queued'
    } else if (kind === 'toggle-power') {
      p.state = p.state === 'offline' ? 'ready' : 'offline'
    } else if (kind === 'clear') {
      state.jobs = state.jobs.filter((x) => x.printerId !== id)
    }
    emit()
    return true
  },
  elevate: async () => false,
  enableSpooling: async () => ({ ok: true }),
  pickFiles: async () => [],
  openLog: async () => '',
  installUpdate: async () => false,
  updateNow: async () => false,
  addFiles: async () => ({ ok: true, added: 1 }),
  preview: async (path) => ({
    kind: 'text',
    name: path.split('/').pop() ?? path,
    ext: 'txt',
    bytes: 1024,
    pages: 1,
    path,
    text: 'Предпросмотр доступен только в приложении.',
  }),
  thumb: async () => '',
  jobShot: async () => ({ url: '', pages: 0 }),
  openExternal: async () => true,
  incident: async (kind, id) => {
    if (kind === 'dismiss-all') state.incidents.forEach((i) => (i.dismissed = true))
    else if (kind === 'dismiss') {
      const i = state.incidents.find((x) => x.id === id)
      if (i) i.dismissed = true
    } else if (kind === 'forget') {
      state.incidents = state.incidents.filter((x) => x.id !== id)
    }
    emit()
    return true
  },
  settings: async (patch) => {
    Object.assign(settings, patch)
    emit()
    return settings
  },
  window: async () => false,
  pathForFile: () => '',
}
