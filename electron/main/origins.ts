import { basename, extname } from 'node:path'

/**
 * Откуда у системного задания взяться исходному файлу.
 *
 * Спулер про файл ничего не знает: в очереди от него остаётся одно имя
 * документа. Но когда печать запускает само приложение, путь ему известен —
 * достаточно запомнить отправленное и потом узнать задание по имени. Это даёт
 * очереди миниатюру снимка и предпросмотр там, где раньше была только подпись
 * с расширением.
 *
 * Сопоставление идёт по имени без расширения и без привязки к принтеру:
 * перенос заводит на приёмнике новое задание с тем же документом, и снимок
 * должен переехать вместе с ним.
 */

interface Sent {
  path: string
  key: string
  at: number
}

const LIFETIME = 6 * 60 * 60 * 1000
const LIMIT = 400

const sent: Sent[] = []

function keyOf(name: string) {
  const base = basename(name)
  const ext = extname(base)
  return (ext ? base.slice(0, -ext.length) : base).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Приложение отправило файл на печать — запоминаем, чем он был. */
export function rememberPrinted(path: string) {
  const key = keyOf(path)
  if (!key) return
  const now = Date.now()
  const known = sent.find((s) => s.path === path)
  if (known) {
    known.at = now
    return
  }
  sent.push({ path, key, at: now })
  if (sent.length > LIMIT) sent.splice(0, sent.length - LIMIT)
}

/**
 * Путь к файлу задания, если его печатали через приложение. Имя документа у
 * разных программ обрастает приставками («Фотографии — IMG_1234»), поэтому
 * достаточно вхождения, а из подошедших берётся самое свежее.
 */
export function pathForJob(document: string) {
  const name = keyOf(document)
  if (!name) return undefined
  const edge = Date.now() - LIFETIME
  let best: Sent | undefined
  for (const item of sent) {
    if (item.at < edge) continue
    if (item.key !== name && !name.includes(item.key)) continue
    if (!best || item.at > best.at) best = item
  }
  return best?.path
}
