import { readFile, stat, open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PreviewPayload } from '../../shared/types'

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
