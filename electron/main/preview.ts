import { randomUUID } from 'node:crypto'
import { readFile, stat, open, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extOf, type PreviewPayload } from '../../shared/types'
import { CSHARP } from './spool'
import { psJsonFile, psq } from './powershell'
import { BROWSER, PHOTO, decodePhoto } from './photo'

/** Фотоформаты и то, чем их раскодировать, вынесены в photo.ts. */
const IMAGE = PHOTO
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
 * пикселей.
 */
const THUMB_WIDTH = 220
const THUMB_LIMIT = 200
const thumbs = new Map<string, string>()

export async function thumbnail(path: string) {
  const hit = thumbs.get(path)
  if (hit !== undefined) return hit

  const url = await decodePhoto(path, THUMB_WIDTH)

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

/**
 * Второй путь: современные драйверы (в том числе классовый HP) спулят не EMF, а
 * XPS — тот же документ, только упакованный. Разбирать его вручную незачем,
 * WPF открывает такой пакет и отдаёт страницу как визуальный элемент, который
 * рисуется в растр штатным RenderTargetBitmap.
 */
const XPS = `
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @"
${CSHARP}
"@
Add-Type -AssemblyName ReachFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase

$temp = [System.IO.Path]::Combine($env:TEMP, [System.Guid]::NewGuid().ToString() + '.xps')
try {
  $data = [PQSpool]::ReadJob('__PRN__', __JOB__)
  if ($data.Length -lt 4 -or $data[0] -ne 0x50 -or $data[1] -ne 0x4B) { throw 'not-xps' }
  [System.IO.File]::WriteAllBytes($temp, $data)

  $doc = New-Object System.Windows.Xps.Packaging.XpsDocument($temp, 'Read')
  try {
    $paginator = $doc.GetFixedDocumentSequence().DocumentPaginator
    $total = $paginator.PageCount
    $index = [Math]::Min([Math]::Max(__PAGE__, 0), $total - 1)
    $page = $paginator.GetPage($index)

    $scale = [double]__WIDTH__ / $page.Size.Width
    $w = [int][Math]::Round($page.Size.Width * $scale)
    $h = [int][Math]::Round($page.Size.Height * $scale)

    # Лист бумаги белый: XPS-страница фон рисует не всегда, а прозрачный PNG в
    # очереди выглядит дырой.
    $container = New-Object System.Windows.Media.ContainerVisual
    $container.Transform = New-Object System.Windows.Media.ScaleTransform($scale, $scale)
    $sheet = New-Object System.Windows.Media.DrawingVisual
    $ctx = $sheet.RenderOpen()
    $ctx.DrawRectangle([System.Windows.Media.Brushes]::White, $null,
      (New-Object System.Windows.Rect(0, 0, $page.Size.Width, $page.Size.Height)))
    $ctx.Close()
    # Children.Add возвращает индекс, и он уходит в stdout поверх JSON.
    $null = $container.Children.Add($sheet)
    $null = $container.Children.Add($page.Visual)

    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(
      $w, $h, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($container)

    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $out = New-Object System.IO.FileStream('__OUT__', 'Create')
    try { $encoder.Save($out) } finally { $out.Close() }

    ConvertTo-Json -Compress ([pscustomobject]@{ ok = $true; pages = $total })
  } finally { $doc.Close() }
} catch {
  $m = $_.Exception.Message
  if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
  ConvertTo-Json -Compress ([pscustomobject]@{ ok = $false; error = $m })
} finally {
  if (Test-Path $temp) { Remove-Item $temp -Force -ErrorAction SilentlyContinue }
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
  const fill = (template: string) =>
    template
      .replace(/__PRN__/g, psq(printer))
      .replace(/__JOB__/g, String(jobId))
      .replace(/__WIDTH__/g, String(Math.round(width)))
      .replace(/__PAGE__/g, String(Math.max(0, Math.round(page))))
      .replace(/__OUT__/g, psq(file))

  let result: JobShot = { url: '', pages: 0, error: 'helper-failed' }
  let res = await psJsonFile<{ ok: boolean; pages?: number; error?: string }>(fill(SHOT), 60000)
  // Драйвер спулит не EMF, а XPS — тогда страницу рисует WPF.
  if (res && !res.ok && res.error === 'no-emf') {
    res = await psJsonFile<{ ok: boolean; pages?: number; error?: string }>(fill(XPS), 60000)
  }
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
  const ext = extOf(path)
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
  const ext = extOf(path)
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
    // Что браузер покажет сам — отдаём ссылкой, в полном качестве и без работы.
    // TIFF, HEIC и RAW он не знает: их раскодирует Windows, и в окно уезжает
    // уменьшенная копия — на экран её хватает с запасом.
    const url = BROWSER.has(ext) ? previewUrl(path) : await decodePhoto(path, 1800)
    return url
      ? { kind: 'image', name, ext, bytes, pages, modified, path, url }
      : {
          kind: 'none',
          name,
          ext,
          bytes,
          pages,
          modified,
          path,
          note: 'Windows не знает этот формат — поставьте расширение для него из Microsoft Store',
        }
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
