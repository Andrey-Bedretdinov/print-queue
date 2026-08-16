import { execFile } from 'node:child_process'

const PS = 'powershell.exe'
const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

/** Runs a PowerShell snippet and parses its JSON output. Never throws. */
export function psJson<T>(script: string, timeout = 12000): Promise<T | null> {
  return new Promise((resolve) => {
    execFile(
      PS,
      [...BASE_ARGS, script],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err && !stdout) return resolve(null)
        const text = stdout.trim()
        if (!text) return resolve(null)
        try {
          resolve(JSON.parse(text) as T)
        } catch {
          resolve(null)
        }
      },
    )
  })
}

/** Fire-and-forget PowerShell. Resolves to true when the exit code is 0. */
export function psRun(script: string, timeout = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      PS,
      [...BASE_ARGS, script],
      { timeout, windowsHide: true, encoding: 'utf8' },
      (err) => resolve(!err),
    )
  })
}

/** Escapes a value for a single-quoted PowerShell string literal. */
export function psq(value: string) {
  return value.replace(/'/g, "''")
}
