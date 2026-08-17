import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Job } from '../../shared/types'
import { api } from '../lib/api'
import { typeColor, typeLabel } from '../lib/format'

/**
 * Что имеет смысл показывать картинкой. Список шире, чем понимает браузер:
 * TIFF, HEIC и RAW раскодирует главный процесс силами Windows.
 */
const IMAGE = new Set([
  'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'webp', 'bmp', 'dib', 'ico', 'avif',
  'tif', 'tiff', 'heic', 'heif', 'jxr', 'wdp', 'hdp',
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf',
  'rw2', 'raw', 'dng', 'pef', 'srw', 'x3f', '3fr', 'iiq',
])

/**
 * Миниатюра одна на файл: строка в очереди и увеличение по наведению берут её
 * из общего кэша, а не дёргают главный процесс на каждое движение мыши.
 * Пустая строка — снимок не прочитался, значит остаётся значок с расширением.
 */
const cache = new Map<string, Promise<string>>()

function thumbOf(path: string) {
  let pending = cache.get(path)
  if (!pending) {
    pending = api.thumb(path).catch(() => '')
    cache.set(path, pending)
  }
  return pending
}

/**
 * Задание из чужой программы: файла нет, зато у спулера есть сама страница.
 * Снимок стоит чтения задания целиком, поэтому берётся лениво — по наведению,
 * а не для всей очереди сразу.
 */
function shotOf(jobId: string) {
  let pending = cache.get(jobId)
  if (!pending) {
    pending = api
      .jobShot(jobId, 220)
      .then((shot) => shot.url)
      .catch(() => '')
    cache.set(jobId, pending)
  }
  return pending
}

/** Увеличение не должно вылезать за экран и не должно перекрывать саму строку. */
const POP = 232

function place(rect: DOMRect) {
  const right = rect.right + 10
  const left = right + POP <= window.innerWidth ? right : Math.max(8, rect.left - POP - 10)
  const top = Math.min(Math.max(rect.top + rect.height / 2, POP / 2 + 8), window.innerHeight - POP / 2 - 8)
  return { left, top }
}

export function FileBadge({ job }: { job: Job }) {
  const ref = useRef<HTMLSpanElement>(null)
  const over = useRef(false)
  const [thumb, setThumb] = useState('')
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  const path = job.path
  const isImage = !!path && IMAGE.has(job.ext.replace(/^\./, '').toLowerCase())
  const fromQueue = !path && job.source === 'system'

  useEffect(() => {
    if (!isImage || !path) return
    let alive = true
    void thumbOf(path).then((url) => {
      if (alive) setThumb(url)
    })
    return () => {
      alive = false
    }
  }, [isImage, path])

  // Строка уезжает под курсором при перетаскивании и прокрутке — увеличение,
  // прилипшее к старым координатам, выглядит битым, поэтому просто гасим его.
  useEffect(() => {
    if (!at) return
    const hide = () => setAt(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('pointerdown', hide, true)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('pointerdown', hide, true)
    }
  }, [at])

  const popup = (url: string) => {
    const rect = ref.current?.getBoundingClientRect()
    if (url && rect) setAt(place(rect))
  }

  const show = () => {
    over.current = true
    if (thumb) return popup(thumb)
    if (!fromQueue || busy) return
    setBusy(true)
    void shotOf(job.id).then((url) => {
      setBusy(false)
      if (!url) return
      setThumb(url)
      // Курсор мог уже уехать, пока спулер отдавал страницу.
      if (over.current) popup(url)
    })
  }

  return (
    <>
      <span
        ref={ref}
        className={`ftype${thumb ? ' shot' : ''}${busy ? ' busy' : ''}`}
        style={thumb ? undefined : { background: typeColor(job.ext) }}
        onMouseEnter={show}
        onMouseLeave={() => {
          over.current = false
          setAt(null)
        }}
      >
        {thumb ? <img src={thumb} alt="" draggable={false} /> : typeLabel(job.ext)}
      </span>

      {at &&
        thumb &&
        createPortal(
          <div className="shot-pop" style={{ left: at.left, top: at.top }}>
            <img src={thumb} alt="" />
            <span>{job.name}</span>
          </div>,
          document.body,
        )}
    </>
  )
}
