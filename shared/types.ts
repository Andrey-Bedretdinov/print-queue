/** Domain model shared between the Electron main process and the renderer. */

export type ConnectionKind = 'network' | 'usb' | 'virtual'

export type PrinterState =
  | 'ready'
  | 'printing'
  | 'paused'
  | 'offline'
  | 'warning'
  | 'error'

export type JobState =
  | 'queued'
  | 'printing'
  | 'paused'
  | 'error'
  | 'completed'
  | 'canceled'

export type JobFailure =
  | 'paper_jam'
  | 'out_of_paper'
  | 'out_of_toner'
  | 'offline'
  | 'driver_error'
  | 'spool_error'
  | 'canceled_by_printer'

export interface Consumable {
  id: string
  label: string
  level: number
  color: string
}

export interface Printer {
  id: string
  name: string
  model: string
  connection: ConnectionKind
  address: string
  state: PrinterState
  detail?: string
  source: 'system' | 'sim'
  paused: boolean
  default: boolean
  color: boolean
  duplex: boolean
  consumables: Consumable[]
  tray: number
  speed: number
}

export interface Job {
  id: string
  printerId: string
  name: string
  ext: string
  path?: string
  bytes: number
  pages: number
  printedPages: number
  copies: number
  owner: string
  state: JobState
  failure?: JobFailure
  submittedAt: number
  startedAt?: number
  finishedAt?: number
  signature: string
  source: 'system' | 'sim'
  movedFrom?: string
  retries: number
}

/** A tracked failure. Survives restarts until resolved or dismissed. */
export interface Incident {
  id: string
  signature: string
  jobName: string
  ext: string
  path?: string
  pages: number
  printerId: string
  printerName: string
  failure: JobFailure
  at: number
  resolved: boolean
  resolvedAt?: number
  resolvedPrinterName?: string
  dismissed: boolean
}

export interface Settings {
  theme: 'light' | 'dark'
  simulation: boolean
  pollMs: number
  railCollapsed: boolean
  compact: boolean
  /** Printer ids the user has hidden from the board and the rail. */
  hidden: string[]
  /** Printer ids in display order; anything unknown is appended. */
  order: string[]
  /** `board` — колонки с горизонтальной прокруткой, `grid` — сетка по окну. */
  layout: 'board' | 'grid'
  /** Высота блока очереди в режиме сетки, px. */
  cardHeight: number
  /** Подгонять высоту блоков под окно, чтобы не оставалось пустого места. */
  cardAuto: boolean
}

export interface AppState {
  printers: Printer[]
  jobs: Job[]
  incidents: Incident[]
  settings: Settings
  systemAvailable: boolean
  /** Версия приложения — чтобы было видно, какая сборка запущена. */
  version: string
  /** Читается ли спул-каталог: без этого чужие задания не перенести. */
  canMoveSystem: boolean
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'none'

export interface PreviewPayload {
  kind: PreviewKind
  name: string
  ext: string
  bytes: number
  pages: number
  modified?: number
  path?: string
  url?: string
  text?: string
  note?: string
}

export const FAILURE_LABEL: Record<JobFailure, string> = {
  paper_jam: 'Замятие бумаги',
  out_of_paper: 'Нет бумаги',
  out_of_toner: 'Нет тонера',
  offline: 'Нет связи',
  driver_error: 'Ошибка драйвера',
  spool_error: 'Ошибка спулера',
  canceled_by_printer: 'Сброшено принтером',
}

export const PRINTER_STATE_LABEL: Record<PrinterState, string> = {
  ready: 'Готов',
  printing: 'Печать',
  paused: 'Пауза',
  offline: 'Не в сети',
  warning: 'Внимание',
  error: 'Ошибка',
}
