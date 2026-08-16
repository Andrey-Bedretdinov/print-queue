import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { SCRIPT, parseSystem, type RawSnapshot } from './windows-source'
import type { Job, Printer } from '../../shared/types'

/**
 * Один живой процесс PowerShell вместо запуска на каждый опрос.
 *
 * Спавн powershell.exe стоит около секунды, и на парке из десяти принтеров
 * опрос не успевал за интервалом: очередь в окне отставала от спулера, а
 * оборванный запрос оставлял на экране уже напечатанные задания. Теперь
 * скрипт крутится сам и пишет по строке JSON на каждый снимок, а сторож
 * чистит экран, если спулер замолчал.
 */
export class SpoolWatcher {
  private child: ChildProcessByStdio<Writable, Readable, null> | null = null
  private buffer = ''
  private lastLineAt = 0
  private guard: NodeJS.Timeout | null = null
  private stopped = false

  constructor(
    private intervalMs: number,
    private onSnapshot: (data: { printers: Printer[]; jobs: Job[] }) => void,
    private onSilence: (hard: boolean) => void,
  ) {}

  start() {
    this.stopped = false
    this.spawn()
    this.guard = setInterval(() => {
      if (!this.lastLineAt) return
      const silent = Date.now() - this.lastLineAt
      if (silent > this.intervalMs * 4 + 4000) this.onSilence(silent > 15000)
      if (silent > 20000) this.restart()
    }, 2000)
  }

  stop() {
    this.stopped = true
    if (this.guard) clearInterval(this.guard)
    this.child?.kill()
    this.child = null
  }

  /** Немедленный снимок вне очереди — после действий пользователя. */
  poke() {
    this.child?.stdin.write('\n')
  }

  private restart() {
    this.child?.kill()
    this.child = null
    if (!this.stopped) this.spawn()
  }

  private spawn() {
    const loop =
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
      `$ErrorActionPreference = 'SilentlyContinue'; ` +
      `while ($true) { ${SCRIPT}; [Console]::Out.Flush(); Start-Sleep -Milliseconds ${this.intervalMs} }`

    try {
      this.child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', loop],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
      )
    } catch {
      this.child = null
      return
    }

    const child = this.child
    if (!child) return
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(chunk))
    child.on('exit', () => {
      this.child = null
      if (!this.stopped) setTimeout(() => this.spawn(), 1500)
    })
  }

  private consume(chunk: string) {
    this.buffer += chunk
    let cut = this.buffer.indexOf('\n')
    while (cut >= 0) {
      const line = this.buffer.slice(0, cut).trim()
      this.buffer = this.buffer.slice(cut + 1)
      cut = this.buffer.indexOf('\n')
      if (!line.startsWith('{')) continue
      try {
        const raw = JSON.parse(line) as RawSnapshot
        this.lastLineAt = Date.now()
        this.onSnapshot(parseSystem(raw))
      } catch {
        /* оборванная строка — ждём следующую */
      }
    }
    // Строка длиннее разумного означает, что мы что-то потеряли.
    if (this.buffer.length > 4 * 1024 * 1024) this.buffer = ''
  }
}
