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
    openExternal: 'pq:open-external',
    incident: 'pq:incident',
    settings: 'pq:settings',
    window: 'pq:window',
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
}
