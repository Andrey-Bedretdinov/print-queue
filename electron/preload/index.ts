import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  IncidentActionKind,
  JobActionKind,
  PrinterActionKind,
  ToastMessage,
  WindowActionKind,
} from '../../shared/ipc'
import type { AppState, PreviewPayload, Settings } from '../../shared/types'

const api = {
  getState: (): Promise<AppState | null> => ipcRenderer.invoke(IPC.invoke.getState),
  onState: (cb: (state: AppState) => void) => {
    const handler = (_e: unknown, state: AppState) => cb(state)
    ipcRenderer.on(IPC.state, handler)
    return (): void => void ipcRenderer.off(IPC.state, handler)
  },
  onToast: (cb: (toast: ToastMessage) => void) => {
    const handler = (_e: unknown, toast: ToastMessage) => cb(toast)
    ipcRenderer.on(IPC.toast, handler)
    return (): void => void ipcRenderer.off(IPC.toast, handler)
  },
  onWindowState: (cb: (maximized: boolean) => void) => {
    const handler = (_e: unknown, value: boolean) => cb(value)
    ipcRenderer.on('pq:window-state', handler)
    return (): void => void ipcRenderer.off('pq:window-state', handler)
  },
  jobAction: (jobId: string, kind: JobActionKind): Promise<boolean> =>
    ipcRenderer.invoke(IPC.invoke.jobAction, jobId, kind),
  renamePrinter: (printerId: string, name: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC.invoke.rename, printerId, name),
  elevate: (): Promise<boolean> => ipcRenderer.invoke(IPC.invoke.elevate),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.invoke.pickFiles),
  openLog: (): Promise<string> => ipcRenderer.invoke(IPC.invoke.openLog),
  enableSpooling: (printerId: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC.invoke.enableSpooling, printerId),
  moveJob: (
    jobId: string,
    printerId: string,
    position: number,
  ): Promise<{ ok: boolean; reason?: string; needsAdmin?: boolean; needsSpooling?: string }> =>
    ipcRenderer.invoke(IPC.invoke.moveJob, jobId, printerId, position),
  printerAction: (printerId: string, kind: PrinterActionKind): Promise<boolean> =>
    ipcRenderer.invoke(IPC.invoke.printerAction, printerId, kind),
  addFiles: (paths: string[], printerId: string): Promise<{ ok: boolean; added: number }> =>
    ipcRenderer.invoke(IPC.invoke.addFiles, paths, printerId),
  preview: (path: string): Promise<PreviewPayload> => ipcRenderer.invoke(IPC.invoke.preview, path),
  /** Уменьшенная копия снимка (data-URL) либо пустая строка. */
  thumb: (path: string): Promise<string> => ipcRenderer.invoke(IPC.invoke.thumb, path),
  openExternal: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.invoke.openExternal, path),
  incident: (kind: IncidentActionKind, id?: string, printerId?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.invoke.incident, kind, id, printerId),
  settings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.invoke.settings, patch),
  window: (kind: WindowActionKind): Promise<boolean> =>
    ipcRenderer.invoke(IPC.invoke.window, kind),
  /** Electron 32+ removed File.path; this is the supported replacement. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
}

contextBridge.exposeInMainWorld('pq', api)

export type PqApi = typeof api
