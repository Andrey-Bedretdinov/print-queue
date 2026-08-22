import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ToastMessage } from '../../shared/ipc'
import { log } from './spool'

/**
 * Обновление на месте.
 *
 * Приложение стоит на рабочей машине фотопечати, куда никто не ходит с
 * установщиком: новую сборку надо доставлять самому. Релизы уже собирает
 * GitHub Actions по тегу и кладёт рядом `latest.yml` — electron-updater читает
 * ровно его, поэтому ничего, кроме подписки на события, тут не нужно.
 *
 * Обновление **не ставится молча**. Печать идёт пачками, и приложение,
 * перезапустившееся посреди очереди, выглядит как сбой. Поэтому: скачиваем в
 * фоне, а перезапуск предлагаем кнопкой в уведомлении — момент выбирает
 * человек. Если он его не выберет, установщик отработает при обычном выходе.
 */

const HOURS = 4 * 60 * 60 * 1000

type Notify = (toast: ToastMessage) => void

let ready = false

export function updateReady() {
  return ready
}

export function startUpdates(notify: Notify) {
  // В отладке рядом нет ни установщика, ни app-update.yml — проверять нечего.
  if (!app.isPackaged) return

  // Ставим установщик сами, кнопкой: тихая подмена на ходу собьёт очередь.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log(`обновление ${info.version} найдено, качаю`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    ready = true
    log(`обновление ${info.version} скачано, ждёт перезапуска`)
    notify({
      id: randomUUID(),
      kind: 'ok',
      text: `Готово обновление ${info.version}`,
      sub: `Сейчас ${app.getVersion()}. Обновится при следующем запуске`,
      action: 'update',
    })
  })

  // Молчим: интернет на стенде отваливается, и красное уведомление об этом
  // раз в четыре часа — ровно тот шум, из-за которого перестают читать все.
  autoUpdater.on('error', (err) => {
    log(`проверка обновлений не удалась: ${err?.message ?? err}`)
  })

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {
      /* об ошибке уже сказал обработчик выше */
    })
  }

  // Первая проверка не сразу: на старте приложение и так занято опросом
  // спулера, а обновление не горит.
  setTimeout(check, 20_000)
  setInterval(check, HOURS)
}

/** Перезапуск с установкой — по кнопке в уведомлении. */
export function installUpdate() {
  if (!ready) return false
  log('перезапуск на обновление')
  // Тихо и с обратным запуском: установщик ставится на всю машину и требует
  // прав, но приложение уже работает от администратора и передаёт их дальше —
  // мастер установки показывать незачем.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
  return true
}
