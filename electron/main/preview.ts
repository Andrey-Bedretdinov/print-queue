import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, stat, open, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PreviewPayload } from '../../shared/types'
import { CSHARP } from './spool'
import { psJsonFile, psq } from './powershell'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const TEXT = new Set([
  'txt', 'log', 'csv', 'tsv', 'json', 'xml', 'md', 'yml', 'yaml', 'ini', 'cfg', 'sql',
  'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'py', 'ps1', 'bat', 'sh', 'c', 'h', 'cpp', 'cs', 'go', 'rs',
])

const OFFICE: Record<string, string> = {
  doc: 'Документ Word',
  docx: 'Документ Word',
  xls: 'Книга Excel',
  xlsx: 'Книга Excel',
  ppt: 'Презентация PowerPoint',
  pptx: 'Презентация PowerPoint',
  odt: 'Документ OpenDocument',
  rtf: 'Документ RTF',
}

/** file:// is blocked from the renderer's origin, so previews use our scheme. */
export function previewUrl(path: string) {
  return 'pq-file://local' + pathToFileURL(path).pathname
}

/**
 * Уменьшенная копия снимка для очереди: и в значок строки, и в увеличение по
 * наведению. Отдавать в интерфейс сам файл нельзя — в фотоочереди это десятки
 * мегабайт на строку, которые браузер честно раскодирует целиком ради шестнадцати
 * пикселей. nativeImage умеет это сам, без сторонних библиотек.
 */
const THUMB_WIDTH = 220
const THUMB_LIMIT = 200
const thumbs = new Map<string, string>()

export async function thumbnail(path: string) {
  const hit = thumbs.get(path)
  if (hit !== undefined) return hit

  let url = ''
  try {
    const ext = extname(path).slice(1).toLowerCase()
    if (IMAGE.has(ext)) {
      const image = nativeImage.createFromPath(path)
      if (!image.isEmpty()) {
        const small =
          image.getSize().width > THUMB_WIDTH
            ? image.resize({ width: THUMB_WIDTH, quality: 'good' })
            : image
        // Фотографии уезжают JPEG'ом: PNG с той же картинки тяжелее на порядок,
        // а прозрачности в снимке всё равно нет.
        url =
          ext === 'jpg' || ext === 'jpeg'
            ? `data:image/jpeg;base64,${small.toJPEG(78).toString('base64')}`
            : small.toDataURL()
      }
    }
  } catch {
    /* нечитаемый файл — строка обойдётся значком с расширением */
  }

  // Кэш держит только последние снимки: очередь живёт долго, память — нет.
  if (thumbs.size >= THUMB_LIMIT) {
    const oldest = thumbs.keys().next().value
    if (oldest !== undefined) thumbs.delete(oldest)
  }
  thumbs.set(path, url)
  return url
}

/**
 * Снимок страницы задания прямо из очереди — для печати, пришедшей из чужой
 * программы. Пути к файлу у спулера нет, зато есть сама страница в EMF.
 */
const SHOT = `
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @"
${CSHARP}
"@

try {
  $n = [PQSpool]::Shot('__PRN__', __JOB__, __WIDTH__, __PAGE__, '__OUT__')
  ConvertTo-Json -Compress ([pscustomobject]@{ ok = $true; pages = $n })
} catch {
  $m = $_.Exception.Message
  if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
  ConvertTo-Json -Compress ([pscustomobject]@{ ok = $false; error = $m })
}
`

export interface JobShot {
  url: string
  pages: number
  error?: string
}

const shots = new Map<string, JobShot>()

/**
 * Снимок кэшируется: одна страница крупного фото читается из спулера и
 * перерисовывается заметное время, а очередь перерисовывается постоянно.
 */
export async function jobShot(
  printer: string,
  jobId: number,
  width: number,
  page = 0,
): Promise<JobShot> {
  const key = `${printer}#${jobId}#${width}#${page}`
  const hit = shots.get(key)
  if (hit) return hit

  const file = join(tmpdir(), `pq-shot-${randomUUID()}.png`)
  const script = SHOT.replace('__PRN__', psq(printer))
    .replace('__JOB__', String(jobId))
    .replace('__WIDTH__', String(Math.round(width)))
    .replace('__PAGE__', String(Math.max(0, Math.round(page))))
    .replace('__OUT__', psq(file))

  let result: JobShot = { url: '', pages: 0, error: 'helper-failed' }
  const res = await psJsonFile<{ ok: boolean; pages?: number; error?: string }>(script, 60000)
  if (res?.ok) {
    try {
      const png = await readFile(file)
      result = { url: `data:image/png;base64,${png.toString('base64')}`, pages: res.pages ?? 1 }
    } catch {
      result = { url: '', pages: 0, error: 'read-failed' }
    }
  } else if (res) {
    result = { url: '', pages: 0, error: res.error }
  }
  void unlink(file).catch(() => {})

  if (shots.size >= THUMB_LIMIT) {
    const oldest = shots.keys().next().value
    if (oldest !== undefined) shots.delete(oldest)
  }
  // Неудачу тоже помним: иначе наведение мышью будет дёргать спулер без конца.
  shots.set(key, result)
  return result
}

function decode(buf: Buffer) {
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('�')) return utf8
  try {
    return new TextDecoder('windows-1251').decode(buf)
  } catch {
    return utf8
  }
}

/** Cheap page estimate: enough for a queue view, no parsing libraries needed. */
export async function estimatePages(path: string, bytes: number) {
  const ext = extname(path).slice(1).toLowerCase()
  if (IMAGE.has(ext)) return 1
  if (ext === 'pdf') {
    try {
      const fh = await open(path, 'r')
      const size = (await fh.stat()).size
      const len = Math.min(size, 4 * 1024 * 1024)
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, Math.max(0, size - len))
      await fh.close()
      const text = buf.toString('latin1')
      const counts = text.match(/\/Type\s*\/Page[^s]/g)
      if (counts?.length) return counts.length
      const kids = text.match(/\/Count\s+(\d+)/)
      if (kids) return Math.max(1, Number(kids[1]))
    } catch {
      /* fall through to the size heuristic */
    }
    return Math.max(1, Math.round(bytes / 45_000))
  }
  if (TEXT.has(ext)) {
    try {
      const buf = await readFile(path)
      const lines = decode(buf.subarray(0, 2 * 1024 * 1024)).split(/\r?\n/).length
      return Math.max(1, Math.ceil(lines / 48))
    } catch {
      return 1
    }
  }
  return Math.max(1, Math.round(bytes / 60_000))
}

export async function buildPreview(path: string): Promise<PreviewPayload> {
  const name = basename(path)
  const ext = extname(path).slice(1).toLowerCase()
  let bytes = 0
  let modified: number | undefined
  try {
    const s = await stat(path)
    bytes = s.size
    modified = s.mtimeMs
  } catch {
    return { kind: 'none', name, ext, bytes: 0, pages: 0, note: 'Файл недоступен' }
  }
  const pages = await estimatePages(path, bytes)
  if (IMAGE.has(ext)) {
    return { kind: 'image', name, ext, bytes, pages, modified, path, url: previewUrl(path) }
  }
  if (ext === 'pdf') {
    return { kind: 'pdf', name, ext, bytes, pages, modified, path, url: previewUrl(path) }
  }
  if (TEXT.has(ext)) {
    try {
      const buf = await readFile(path)
      const text = decode(buf.subarray(0, 256 * 1024))
      return {
        kind: 'text',
        name,
        ext,
        bytes,
        pages,
        modified,
        path,
        text,
        note: buf.length > 256 * 1024 ? 'Показано начало файла' : undefined,
      }
    } catch {
      return { kind: 'none', name, ext, bytes, pages, modified, path, note: 'Не удалось прочитать' }
    }
  }
  return {
    kind: 'none',
    name,
    ext,
    bytes,
    pages,
    modified,
    path,
    note: OFFICE[ext] ?? 'Предпросмотр недоступен',
  }
}
