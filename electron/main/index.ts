import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeTheme } from 'electron'
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { IPC } from '../../shared/ipc'
import type { JobActionKind, PrinterActionKind, ToastMessage } from '../../shared/ipc'
import type { AppState, Settings } from '../../shared/types'
import { initStore, store } from './store'
import { PrintManager } from './manager'
import { buildPreview, jobShot, thumbnail } from './preview'
import { jobRef } from './windows-source'
import { psRun } from './powershell'

process.env.APP_ROOT = join(__dirname, '..', '..')
const DEV_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIR = join(process.env.APP_ROOT, 'dist')

protocol.registerSchemesAsPrivileged([
  { scheme: 'pq-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// Отбивка на старт печати звучит сама по себе, без клика: Chromium иначе ждёт
// действия пользователя и молча гасит звук.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

let win: BrowserWindow | null = null
let manager: PrintManager | null = null

function send<T>(channel: string, payload: T) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow() {
  const saved = store.bounds
  win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: store.settings.theme === 'dark' ? '#1b2434' : '#edeef0',
    icon: join(process.env.APP_ROOT!, 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  if (process.env.PQ_DEV_CTRL) {
    void import('./devctrl').then((m) => win && m.attach(win, process.env.PQ_DEV_CTRL!))
  }
  win.on('maximize', () => send('pq:window-state', true))
  win.on('unmaximize', () => send('pq:window-state', false))
  win.on('close', () => {
    if (!win) return
    const box = win.getNormalBounds()
    store.setBounds({ ...box, maximized: win.isMaximized() })
  })
  if (saved.maximized) win.maximize()

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(join(RENDERER_DIR, 'index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  initStore()
  nativeTheme.themeSource = store.settings.theme

  protocol.handle('pq-file', (request) => {
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname)
    return net.fetch(pathToFileURL(path.replace(/^\/([A-Za-z]:)/, '$1')).toString())
  })

  createWindow()

  manager = new PrintManager(
    (state: AppState) => send(IPC.state, state),
    (toast: ToastMessage) => send(IPC.toast, toast),
  )
  manager.version = app.getVersion()
  manager.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  manager?.stop()
  store.flush()
  app.quit()
})

// ------------------------------------------------------------------- ipc

ipcMain.handle(IPC.invoke.getState, () => manager?.state() ?? null)

ipcMain.handle(IPC.invoke.jobAction, (_e, jobId: string, kind: JobActionKind) =>
  manager?.jobAction(jobId, kind),
)

ipcMain.handle(IPC.invoke.moveJob, (_e, jobId: string, printerId: string, position: number) =>
  manager?.moveJob(jobId, printerId, position),
)

ipcMain.handle(IPC.invoke.printerAction, (_e, printerId: string, kind: PrinterActionKind) =>
  manager?.printerAction(printerId, kind),
)

ipcMain.handle(IPC.invoke.addFiles, (_e, paths: string[], printerId: string) =>
  manager?.addFiles(paths, printerId),
)

/**
 * Приложение запускается с правами администратора, а проводник — без них, и
 * Windows не разрешает перетаскивание между разными уровнями. Поэтому выбор
 * файлов диалогом остаётся единственным надёжным способом добавить печать.
 */
ipcMain.handle(IPC.invoke.pickFiles, async () => {
  if (!win) return []
  const res = await dialog.showOpenDialog(win, {
    title: 'Файлы для печати',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Документы', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'txt', 'png', 'jpg', 'jpeg'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  })
  return res.canceled ? [] : res.filePaths
})

ipcMain.handle(IPC.invoke.preview, (_e, path: string) => buildPreview(path))
ipcMain.handle(IPC.invoke.thumb, (_e, path: string) => thumbnail(path))

/** Снимок страницы системного задания: идентификатор вида «sys:Принтер:17». */
ipcMain.handle(IPC.invoke.jobShot, (_e, id: string, width: number, page: number) => {
  if (!id.startsWith('sys:')) return { url: '', pages: 0, error: 'not-system' }
  const { printer, id: jobId } = jobRef(id)
  return jobShot(printer, jobId, width, page)
})

ipcMain.handle(IPC.invoke.openExternal, async (_e, path: string) => {
  const err = await shell.openPath(path)
  return !err
})

ipcMain.handle(IPC.invoke.incident, (_e, kind: string, id?: string, printerId?: string) =>
  manager?.incidentAction(kind, id, printerId),
)

ipcMain.handle(IPC.invoke.settings, (_e, patch: Partial<Settings>) => {
  if (patch.theme) nativeTheme.themeSource = patch.theme
  return manager?.updateSettings(patch)
})

ipcMain.handle(IPC.invoke.rename, (_e, printerId: string, name: string) =>
  manager?.renamePrinter(printerId, name),
)

ipcMain.handle(IPC.invoke.enableSpooling, (_e, printerId: string) =>
  manager?.enableSpooling(printerId),
)

/** Показывает журнал переносов в проводнике — путь искать вручную не нужно. */
ipcMain.handle(IPC.invoke.openLog, () => {
  const file = join(app.getPath('userData'), 'move.log')
  if (!existsSync(file)) writeFileSync(file, '', 'utf8')
  shell.showItemInFolder(file)
  return file
})

/** Перезапуск с правами администратора — нужен для переноса чужих заданий. */
ipcMain.handle(IPC.invoke.elevate, async () => {
  const exe = process.execPath
  const args = app.isPackaged ? '' : ` -ArgumentList '${app.getAppPath().replace(/'/g, "''")}'`
  const ok = await psRun(
    `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -Verb RunAs${args}`,
    30000,
  )
  if (ok) setTimeout(() => app.quit(), 500)
  return ok
})

ipcMain.handle(IPC.invoke.window, (_e, kind: string) => {
  if (!win) return false
  if (kind === 'minimize') win.minimize()
  else if (kind === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
  else if (kind === 'close') win.close()
  return win.isMaximized()
})
