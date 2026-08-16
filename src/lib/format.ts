export function bytes(value: number) {
  if (!value) return '—'
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} КБ`
  return `${(value / 1024 / 1024).toFixed(1)} МБ`
}

export function pages(count: number) {
  return `${Math.max(1, Math.round(count))} стр.`
}

export function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s} с`
  if (s < 3600) return `${Math.round(s / 60)} мин`
  if (s < 86400) return `${Math.round(s / 3600)} ч`
  return `${Math.round(s / 86400)} дн`
}

export function clock(ts?: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function eta(secs: number) {
  if (!isFinite(secs) || secs <= 0) return '—'
  if (secs < 60) return `${Math.round(secs)} с`
  return `${Math.round(secs / 60)} мин`
}

const TYPE_COLORS: Record<string, string> = {
  pdf: '#d44630',
  doc: '#2b579a',
  docx: '#2b579a',
  rtf: '#2b579a',
  odt: '#2b579a',
  xls: '#1e7049',
  xlsx: '#1e7049',
  csv: '#1e7049',
  ppt: '#d24726',
  pptx: '#d24726',
  txt: '#768187',
  log: '#768187',
  md: '#768187',
  png: '#8e5bd0',
  jpg: '#8e5bd0',
  jpeg: '#8e5bd0',
  gif: '#8e5bd0',
  webp: '#8e5bd0',
  svg: '#8e5bd0',
  bmp: '#8e5bd0',
  zip: '#b58900',
}

export function typeColor(ext: string) {
  return TYPE_COLORS[ext.toLowerCase()] ?? '#949b9f'
}

export function typeLabel(ext: string) {
  const clean = ext.replace(/^\./, '')
  if (!clean) return '·'
  return clean.length > 4 ? clean.slice(0, 4) : clean
}
