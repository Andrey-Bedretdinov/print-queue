import { app, nativeImage } from 'electron'
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { JobSeed } from './simulator'

/**
 * The simulated queue points at real files on disk so that preview, size and
 * page count are genuine rather than mocked numbers.
 */

interface Doc {
  file: string
  pages: number
  title: string
  kind: 'letter' | 'invoice' | 'report' | 'label'
}

const DOCS: Doc[] = [
  { file: 'Договор аренды.pdf', pages: 6, title: 'AGREEMENT No. 114/25', kind: 'letter' },
  { file: 'Счёт 2481.pdf', pages: 1, title: 'INVOICE 2481', kind: 'invoice' },
  { file: 'Отчёт Q3.pdf', pages: 12, title: 'QUARTERLY REPORT Q3', kind: 'report' },
  { file: 'Накладная 77.pdf', pages: 2, title: 'DELIVERY NOTE 77', kind: 'invoice' },
  { file: 'Этикетки 50x30.pdf', pages: 24, title: 'LABELS 50x30', kind: 'label' },
]

/**
 * Эмуляции нужны настоящие снимки, а не заглушки: миниатюра в строке, увеличение
 * по наведению и окно предпросмотра работают с файлом, и проверять их на пустом
 * месте бессмысленно. Кадр рисуется здесь же, чтобы в репозитории не заводить
 * двоичных файлов.
 */
const PHOTO_W = 1200
const PHOTO_H = 800

function photoPixels(shift: number) {
  const px = Buffer.alloc(PHOTO_W * PHOTO_H * 4)
  const wave = (x: number, k: number) => Math.sin((x / PHOTO_W) * Math.PI * k + shift)

  for (let y = 0; y < PHOTO_H; y++) {
    const sky = y / PHOTO_H
    for (let x = 0; x < PHOTO_W; x++) {
      // Закат: снизу тёплый, сверху холодный, плюс солнце и гряда холмов.
      let r = 250 - sky * 90 + wave(x, 2) * 6
      let g = 170 - sky * 40 + wave(x, 3) * 5
      let b = 120 + sky * 120 + wave(x, 1) * 8

      const dx = x - PHOTO_W * 0.68
      const dy = y - PHOTO_H * 0.34
      const sun = Math.hypot(dx, dy)
      if (sun < 90) {
        const glow = 1 - sun / 90
        r += glow * 60
        g += glow * 70
        b += glow * 40
      }

      const hill = PHOTO_H * (0.72 + 0.06 * Math.sin((x / PHOTO_W) * Math.PI * 2 + shift))
      if (y > hill) {
        const deep = (y - hill) / (PHOTO_H - hill)
        r *= 0.28 - deep * 0.1
        g *= 0.3 - deep * 0.1
        b *= 0.38 - deep * 0.1
      }

      const i = (y * PHOTO_W + x) * 4
      // nativeImage ждёт BGRA.
      px[i] = Math.max(0, Math.min(255, b))
      px[i + 1] = Math.max(0, Math.min(255, g))
      px[i + 2] = Math.max(0, Math.min(255, r))
      px[i + 3] = 255
    }
  }
  return px
}

/** Полосатый TIFF без сжатия: в фотопечать такие приходят со сканеров. */
function buildTiff(bgra: Buffer) {
  const rgb = Buffer.alloc(PHOTO_W * PHOTO_H * 3)
  for (let i = 0, j = 0; i < bgra.length; i += 4, j += 3) {
    rgb[j] = bgra[i + 2]
    rgb[j + 1] = bgra[i + 1]
    rgb[j + 2] = bgra[i]
  }

  const entries: Array<[number, number, number, number]> = []
  const head = Buffer.alloc(8)
  head.write('II', 0, 'ascii')
  head.writeUInt16LE(42, 2)
  head.writeUInt32LE(8, 4)

  const count = 12
  const ifdSize = 2 + count * 12 + 4
  const extraAt = 8 + ifdSize
  const bitsAt = extraAt
  const xresAt = bitsAt + 6
  const yresAt = xresAt + 8
  const dataAt = yresAt + 8

  // тег, тип (3 SHORT, 4 LONG, 5 RATIONAL), количество, значение или смещение
  entries.push([256, 4, 1, PHOTO_W])
  entries.push([257, 4, 1, PHOTO_H])
  entries.push([258, 3, 3, bitsAt])
  entries.push([259, 3, 1, 1])
  entries.push([262, 3, 1, 2])
  entries.push([273, 4, 1, dataAt])
  entries.push([277, 3, 1, 3])
  entries.push([278, 4, 1, PHOTO_H])
  entries.push([279, 4, 1, rgb.length])
  entries.push([282, 5, 1, xresAt])
  entries.push([283, 5, 1, yresAt])
  entries.push([296, 3, 1, 2])

  const ifd = Buffer.alloc(ifdSize)
  ifd.writeUInt16LE(count, 0)
  entries.forEach(([tag, type, n, value], k) => {
    const at = 2 + k * 12
    ifd.writeUInt16LE(tag, at)
    ifd.writeUInt16LE(type, at + 2)
    ifd.writeUInt32LE(n, at + 4)
    if (type === 3 && n === 1) ifd.writeUInt16LE(value, at + 8)
    else ifd.writeUInt32LE(value, at + 8)
  })

  const extra = Buffer.alloc(dataAt - extraAt)
  extra.writeUInt16LE(8, 0)
  extra.writeUInt16LE(8, 2)
  extra.writeUInt16LE(8, 4)
  extra.writeUInt32LE(300, 6)
  extra.writeUInt32LE(1, 10)
  extra.writeUInt32LE(300, 14)
  extra.writeUInt32LE(1, 18)

  return Buffer.concat([head, ifd, extra, rgb])
}

interface Photo {
  file: string
  shift: number
  kind: 'jpg' | 'png' | 'tiff'
}

/**
 * Имена как у печати из Lightroom — основной сценарий у фотографов: кадр
 * отправляется пачкой, в очереди видно, что именно уедет на бумагу.
 */
const PHOTOS: Photo[] = [
  { file: 'Lightroom (_MG_0114.jpg)', shift: 0.2, kind: 'jpg' },
  { file: 'Lightroom (_MG_0122.jpg)', shift: 1.1, kind: 'jpg' },
  { file: 'Lightroom (_MG_0137.jpg)', shift: 2.4, kind: 'jpg' },
  { file: 'Скан обложки.tiff', shift: 3.0, kind: 'tiff' },
  { file: 'Логотип на плёнку.png', shift: 4.2, kind: 'png' },
]

function buildPhoto(photo: Photo) {
  const px = photoPixels(photo.shift)
  if (photo.kind === 'tiff') return buildTiff(px)
  const image = nativeImage.createFromBitmap(px, { width: PHOTO_W, height: PHOTO_H })
  return photo.kind === 'png' ? image.toPNG() : image.toJPEG(88)
}

function esc(text: string) {
  return text.replace(/([()\\])/g, '\\$1')
}

function pageContent(doc: Doc, page: number) {
  const ops: string[] = []
  const H = 842
  // header rule
  ops.push('0.0 0.525 0.796 rg', `56 ${H - 92} 483 3 re f`)
  ops.push('BT /F1 16 Tf 0.1 0.1 0.1 rg 56 ' + (H - 78) + ' Td (' + esc(doc.title) + ') Tj ET')
  ops.push(
    'BT /F1 8 Tf 0.58 0.61 0.62 rg 56 ' +
      (H - 108) +
      ' Td (Page ' +
      page +
      ' of ' +
      doc.pages +
      ') Tj ET',
  )

  let y = H - 140
  if (doc.kind === 'invoice' || doc.kind === 'report') {
    // table grid
    const rows = 14
    const rowH = 26
    ops.push('0.92 0.92 0.92 rg', `56 ${y - rows * rowH} 483 ${rows * rowH} re f`)
    ops.push('1 1 1 rg')
    for (let r = 0; r < rows; r++) {
      ops.push(`57 ${y - (r + 1) * rowH + 1} 481 ${rowH - 2} re f`)
    }
    ops.push('0.0 0.525 0.796 rg', `56 ${y - rowH} 483 ${rowH} re f`)
    ops.push('0.85 0.86 0.87 rg')
    for (let r = 1; r < rows; r++) {
      const ry = y - (r + 1) * rowH + 9
      ops.push(`72 ${ry} ${90 + ((r * 37) % 120)} 7 re f`)
      ops.push(`300 ${ry} 60 7 re f`)
      ops.push(`420 ${ry} ${40 + ((r * 13) % 50)} 7 re f`)
    }
    y -= rows * rowH + 30
  }
  if (doc.kind === 'label') {
    for (let i = 0; i < 3; i++) {
      const ly = y - i * 150
      ops.push('0.1 0.1 0.1 RG 1 w', `${100} ${ly - 110} 400 110 re S`)
      for (let b = 0; b < 40; b++) {
        const w = 1 + ((b * 7) % 3)
        ops.push('0.1 0.1 0.1 rg', `${130 + b * 9} ${ly - 80} ${w} 50 re f`)
      }
      ops.push('BT /F1 10 Tf 0.1 0.1 0.1 rg 130 ' + (ly - 100) + ' Td (SKU-' + (1000 + i + page * 3) + ') Tj ET')
    }
    y -= 460
  }
  // body paragraph placeholders
  ops.push('0.87 0.88 0.89 rg')
  for (let i = 0; i < 12 && y > 90; i++) {
    const w = 483 - ((i * 53) % 160)
    ops.push(`56 ${y} ${w} 8 re f`)
    y -= 18
    if (i % 5 === 4) y -= 12
  }
  ops.push('0.58 0.61 0.62 rg', `56 64 483 1 re f`)
  ops.push('BT /F1 8 Tf 0.58 0.61 0.62 rg 56 48 Td (print-queue sample document) Tj ET')
  return ops.join('\n')
}

function buildPdf(doc: Doc) {
  const objects: string[] = []
  const pageIds: number[] = []
  // 1 catalog, 2 pages, 3 font, then per page: content + page
  let id = 4
  const contents: Array<{ id: number; body: string }> = []
  for (let p = 1; p <= doc.pages; p++) {
    const body = pageContent(doc, p)
    contents.push({ id, body })
    id += 1
    pageIds.push(id)
    id += 1
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Count ${doc.pages} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  contents.forEach((c, i) => {
    objects[c.id] = `<< /Length ${Buffer.byteLength(c.body)} >>\nstream\n${c.body}\nendstream`
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${c.id} 0 R >>`
  })

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out)
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export function ensureSamples(): JobSeed[] {
  const dir = join(app.getPath('userData'), 'samples')
  mkdirSync(dir, { recursive: true })
  const seeds: JobSeed[] = []
  for (const doc of DOCS) {
    const path = join(dir, doc.file)
    if (!existsSync(path)) {
      try {
        writeFileSync(path, buildPdf(doc))
      } catch {
        continue
      }
    }
    let bytes = 0
    try {
      bytes = statSync(path).size
    } catch {
      /* ignore */
    }
    seeds.push({ name: doc.file, path, bytes, pages: doc.pages })
  }
  const note = join(dir, 'Список рассылки.txt')
  if (!existsSync(note)) {
    writeFileSync(
      note,
      ['Список рассылки', '', ...Array.from({ length: 40 }, (_, i) => `${i + 1}. Контрагент ${i + 1} — договор ${1000 + i}`)].join('\r\n'),
      'utf8',
    )
  }
  seeds.push({ name: 'Список рассылки.txt', path: note, bytes: statSync(note).size, pages: 2 })

  // Снимки идут в начало: в фотоочереди именно они и печатаются.
  const photos: JobSeed[] = []
  for (const photo of PHOTOS) {
    const path = join(dir, photo.file)
    if (!existsSync(path)) {
      try {
        writeFileSync(path, buildPhoto(photo))
      } catch {
        continue
      }
    }
    try {
      photos.push({ name: photo.file, path, bytes: statSync(path).size, pages: 1 })
    } catch {
      /* файл не записался — очередь обойдётся документами */
    }
  }
  return [...photos, ...seeds]
}
