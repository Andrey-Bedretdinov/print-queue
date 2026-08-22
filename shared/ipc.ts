/** IPC channel names, kept in one place so main and preload can never drift. */
export const IPC = {
  state: 'pq:state',
  ready: 'pq:ready',
  toast: 'pq:toast',
  invoke: {
    getState: 'pq:get-state',
    jobAction: 'pq:job-action',
    moveJob: 'pq:move-job',
    printerAction: 'pq:printer-action',
    addFiles: 'pq:add-files',
    pickFiles: 'pq:pick-files',
    preview: 'pq:preview',
    thumb: 'pq:thumb',
    jobShot: 'pq:job-shot',
    openExternal: 'pq:open-external',
    incident: 'pq:incident',
    settings: 'pq:settings',
    window: 'pq:window',
    rename: 'pq:rename-printer',
    elevate: 'pq:elevate',
    enableSpooling: 'pq:enable-spooling',
    openLog: 'pq:open-log',
    installUpdate: 'pq:install-update',
  },
} as const

export type JobActionKind = 'pause' | 'resume' | 'cancel' | 'retry' | 'top'
export type PrinterActionKind = 'pause' | 'resume' | 'clear' | 'fix' | 'toggle-power'
export type IncidentActionKind = 'dismiss' | 'dismiss-all' | 'reprint' | 'forget'
export type WindowActionKind = 'minimize' | 'maximize' | 'close'

export interface ToastMessage {
  id: string
  kind: 'ok' | 'warn' | 'error' | 'info'
  text: string
  sub?: string
  /** Кнопка в уведомлении: перезапуск с правами, включение очереди печати
   *  или установка скачанного обновления. */
  action?: 'elevate' | 'spool' | 'update'
  /** Принтер, к которому относится действие. */
  actionArg?: string
}
