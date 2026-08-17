import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { psJsonFile, psq } from './powershell'
import { extOf } from '../../shared/types'

/**
 * Раскодирование фотографий для очереди печати.
 *
 * `nativeImage` внутри Electron знает только то, что умеет Chromium: JPEG, PNG,
 * BMP, GIF. В фотопечати этого мало — приходят TIFF со сканера, HEIC с телефона
 * и RAW с камеры. Всё это умеет сама Windows: кодеки WIC ставятся вместе с
 * системой и расширениями из Store, а добраться до них можно через WPF
 * (`BitmapDecoder`) — без единой сторонней зависимости, как и требует проект.
 *
 * RAW — отдельный случай. Кодек для него ставится не всегда, зато каждый RAW
 * несёт внутри готовый JPEG-предпросмотр, который камера кладёт для своего
 * экранчика. Если WIC отказал, достаём этот JPEG прямо из файла: для очереди
 * печати важно узнать кадр, а не получить его в полном качестве.
 */

/** Что раскодирует сам Electron — быстро и без запуска процессов. */
const NATIVE = new Set(['png', 'jpg', 'jpeg', 'bmp', 'ico', 'gif'])

/** Что покажет Chromium, если отдать ссылку на файл как есть. */
export const BROWSER = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg',
])

/** RAW-форматы популярных камер: Canon, Nikon, Sony, Fuji, Olympus, Panasonic. */
const RAW = new Set([
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf',
  'rw2', 'raw', 'dng', 'pef', 'srw', 'x3f', '3fr', 'iiq',
])

/** Всё, что вообще имеет смысл показывать картинкой. */
export const PHOTO = new Set([
  ...NATIVE, ...BROWSER, ...RAW,
  'tif', 'tiff', 'heic', 'heif', 'jxr', 'wdp', 'hdp', 'jfif', 'jpe', 'dib',
])

export function isPhoto(ext: string) {
  return PHOTO.has(ext.replace(/^\./, '').toLowerCase())
}

/**
 * Кодеки WIC доступны через WPF. Ориентацию из EXIF применяем сами: WIC отдаёт
 * кадр как он лежит в файле, и снимок, сделанный вертикально, иначе приедет
 * положенным на бок.
 */
const WIC = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

try {
  $stream = New-Object System.IO.FileStream('__IN__', 'Open', 'Read', 'ReadWrite')
  try {
    $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
      $stream,
      [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
      [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    $frame = $decoder.Frames[0]

    # CMYK и прочую экзотику приводим к обычному RGB, иначе кодировщик откажет.
    $image = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap(
      $frame, [System.Windows.Media.PixelFormats]::Bgr24, $null, 0)

    $scale = [double]__WIDTH__ / $image.PixelWidth
    if ($scale -lt 1) {
      $transform = New-Object System.Windows.Media.ScaleTransform($scale, $scale)
      $image = New-Object System.Windows.Media.Imaging.TransformedBitmap($image, $transform)
    }

    $turn = 0
    try {
      $meta = $frame.Metadata
      if ($meta -and $meta.ContainsQuery('/app1/ifd/{ushort=274}')) {
        switch ([int]$meta.GetQuery('/app1/ifd/{ushort=274}')) {
          3 { $turn = 180 }
          6 { $turn = 90 }
          8 { $turn = 270 }
        }
      }
    } catch {}
    if ($turn -ne 0) {
      $rotate = New-Object System.Windows.Media.RotateTransform($turn)
      $image = New-Object System.Windows.Media.Imaging.TransformedBitmap($image, $rotate)
    }

    $encoder = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder
    $encoder.QualityLevel = 82
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($image))
    $out = New-Object System.IO.FileStream('__OUT__', 'Create')
    try { $encoder.Save($out) } finally { $out.Close() }

    ConvertTo-Json -Compress ([pscustomobject]@{
      ok = $true; width = $image.PixelWidth; height = $image.PixelHeight
    })
  } finally { $stream.Close() }
} catch {
  ConvertTo-Json -Compress ([pscustomobject]@{ ok = $false; error = $_.Exception.Message })
}
`

async function viaWic(path: string, width: number) {
  const out = join(tmpdir(), `pq-photo-${randomUUID()}.jpg`)
  const script = WIC.replace('__IN__', psq(path))
    .replace('__WIDTH__', String(Math.round(width)))
    .replace('__OUT__', psq(out))
  const res = await psJsonFile<{ ok: boolean }>(script, 45000)
  if (!res?.ok) return ''
  try {
    const jpeg = await readFile(out)
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch {
    return ''
  } finally {
    void unlink(out).catch(() => {})
  }
}

/**
 * Встроенный в RAW JPEG. Берём самый крупный: мелкий — иконка для экранчика
 * камеры, крупный — полноразмерный предпросмотр, он и нужен.
 */
function embeddedJpeg(buf: Buffer) {
  let best: Buffer | null = null
  let at = 0
  while (at < buf.length - 3) {
    const start = buf.indexOf('ffd8ff', at, 'hex')
    if (start < 0) break
    const end = buf.indexOf('ffd9', start + 3, 'hex')
    if (end < 0) break
    const candidate = buf.subarray(start, end + 2)
    if (!best || candidate.length > best.length) best = candidate
    at = end + 2
  }
  return best
}

function fromNative(image: Electron.NativeImage, width: number) {
  if (image.isEmpty()) return ''
  const small = image.getSize().width > width ? image.resize({ width, quality: 'good' }) : image
  return `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`
}

/**
 * Картинка заданной ширины как data-URL. Пустая строка означает, что показать
 * нечего — строка очереди обойдётся значком с расширением.
 */
export async function decodePhoto(path: string, width: number): Promise<string> {
  const ext = extOf(path)
  if (!isPhoto(ext)) return ''

  if (NATIVE.has(ext)) {
    try {
      const url = fromNative(nativeImage.createFromPath(path), width)
      if (url) return url
    } catch {
      /* повреждённый файл — попробуем через кодеки Windows */
    }
  }

  const wic = await viaWic(path, width)
  if (wic) return wic

  if (RAW.has(ext)) {
    try {
      const jpeg = embeddedJpeg(await readFile(path))
      if (jpeg) return fromNative(nativeImage.createFromBuffer(jpeg), width)
    } catch {
      /* нет и встроенного снимка — показывать нечего */
    }
  }
  return ''
}
