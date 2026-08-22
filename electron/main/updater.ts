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
 * Ставится сразу и без вопросов — но только пока приложение **только что
 * открыли**: свежезапущенное окно перезапустить не жалко, а вот перезапуск
 * посреди печатной пачки выглядит как сбой. Поэтому обновление, доехавшее
 * позже, ждёт кнопки в уведомлении, а найденное по прямой просьбе ставится
 * сразу — человек уже сказал, чего хочет.
 */

const HOURS = 4 * 60 * 60 * 1000

/** Пауза перед перезапуском: чтобы человек успел прочитать, почему окно моргнуло. */
const READ_TIME = 2500

/**
 * До каких пор запуск считается запуском. Скачивание — это восемьдесят
 * мегабайт, и на плохом канале оно может закончиться сильно позже старта;
 * молча перезапускаться в этот момент уже нельзя.
 */
const STARTUP_WINDOW = 10 * 60_000

type Notify = (toast: ToastMessage) => void
type Reason = 'startup' | 'manual' | 'idle'

let notify: Notify = () => {}
let reason: Reason = 'startup'
let startedAt = 0
let ready = false
let busy = false

function toast(
  kind: ToastMessage['kind'],
  text: string,
  sub?: string,
  action?: ToastMessage['action'],
) {
  notify({ id: randomUUID(), kind, text, sub, action })
}

/** Ставить молча или спросить кнопкой. */
function silent() {
  if (reason === 'manual') return true
  return reason === 'startup' && Date.now() - startedAt < STARTUP_WINDOW
}

export function startUpdates(emit: Notify) {
  notify = emit
  startedAt = Date.now()

  // В отладке рядом нет ни установщика, ни app-update.yml — проверять нечего.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // Кнопку могли и не нажать: тогда установщик отработает при обычном выходе.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-not-available', (info) => {
    busy = false
    if (reason === 'manual') toast('ok', `Установлена последняя версия ${info.version}`)
  })

  autoUpdater.on('update-available', (info) => {
    log(`обновление ${info.version} найдено, качаю`)
    if (reason !== 'idle') {
      toast('info', `Качаю обновление ${info.version}…`, 'Приложение перезапустится само')
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    ready = true
    busy = false
    log(`обновление ${info.version} скачано`)
    if (silent()) {
      toast('ok', `Обновление ${info.version} готово`, 'Перезапускаю…')
      setTimeout(install, READ_TIME)
      return
    }
    toast(
      'ok',
      `Готово обновление ${info.version}`,
      `Сейчас ${app.getVersion()}. Обновится при следующем запуске`,
      'update',
    )
  })

  // На плановой проверке молчим: интернет на стенде отваливается, и красное
  // уведомление об этом раз в четыре часа — ровно тот шум, из-за которого
  // перестают читать все уведомления подряд.
  autoUpdater.on('error', (err) => {
    busy = false
    const text = err?.message ?? String(err)
    log(`проверка обновлений не удалась: ${text}`)
    if (reason === 'manual') toast('warn', 'Не удалось обновиться', text)
  })

  // Не в первую же секунду: окно только открылось, и спулер в этот момент
  // опрашивается впервые — пусть отрисуется очередь, а не полоса загрузки.
  setTimeout(() => check('startup'), 5_000)
  setInterval(() => check('idle'), HOURS)
}

function check(why: Reason) {
  if (busy) return
  busy = true
  reason = why
  autoUpdater.checkForUpdates().catch(() => {
    /* об ошибке уже сказал обработчик выше */
  })
}

/** Пункт «Обновить» в меню версии: проверить и, если есть, поставить сразу. */
export function updateNow() {
  if (!app.isPackaged) {
    toast('info', 'Это сборка для отладки', 'Обновляться неоткуда')
    return false
  }
  if (ready) {
    toast('ok', 'Обновление уже скачано', 'Перезапускаю…')
    setTimeout(install, READ_TIME)
    return true
  }
  if (busy) {
    toast('info', 'Проверка уже идёт')
    return true
  }
  toast('info', 'Проверяю обновление…')
  check('manual')
  return true
}

/** Перезапуск с установкой — по кнопке в уведомлении. */
export function installUpdate() {
  if (!ready) return false
  install()
  return true
}

function install() {
  log('перезапуск на обновление')
  // Тихо и с обратным запуском: установщик ставится на всю машину и требует
  // прав, но приложение уже работает от администратора и передаёт их дальше —
  // мастер установки показывать незачем.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
