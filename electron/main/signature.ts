import { createHash } from 'node:crypto'
import { basename } from 'node:path'

/**
 * Identity of a *document*, not of a job. Two spool jobs for the same file on
 * two different printers share a signature, which is what lets a failure on one
 * printer be cleared by a successful print on another.
 */
export function signatureOf(name: string, bytes: number, pages: number) {
  const clean = basename(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/, '')
    .replace(/\s*[-–—]\s*(копия|copy)\s*\d*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const bucket = bytes > 0 ? Math.round(bytes / 1024) : 0
  return createHash('sha1').update(`${clean}|${bucket}|${pages}`).digest('hex').slice(0, 16)
}
