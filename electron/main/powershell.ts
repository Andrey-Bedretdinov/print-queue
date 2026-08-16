import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = 'powershell.exe'
const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
const FILE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

/**
 * Без этого powershell.exe отдаёт вывод в кодировке консоли (cp866/cp1251),
 * и кириллица в именах принтеров приезжает ромбиками.
 */
const UTF8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; '

/** Runs a PowerShell snippet and parses its JSON output. Never throws. */
export function psJson<T>(script: string, timeout = 12000): Promise<T | null> {
  return new Promise((resolve) => {
    execFile(
      PS,
      [...BASE_ARGS, UTF8 + script],
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

/**
 * То же, но скрипт уезжает файлом. Командная строка Windows обрывается на
 * 32767 символах, а помощник переноса заданий занимает больше двадцати тысяч —
 * передавать его аргументом означает однажды упереться в лимит. BOM
 * обязателен: без него PowerShell 5.1 читает .ps1 как ANSI и ломает кириллицу.
 */
export function psJsonFile<T>(script: string, timeout = 12000): Promise<T | null> {
  return new Promise((resolve) => {
    const path = join(tmpdir(), `pq-${randomUUID()}.ps1`)
    const done = (value: T | null) => {
      void unlink(path).catch(() => {})
      resolve(value)
    }
    writeFile(path, `﻿${UTF8}\r\n${script}`, 'utf8')
      .then(() => {
        execFile(
          PS,
          [...FILE_ARGS, path],
          { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
          (err, stdout) => {
            if (err && !stdout) return done(null)
            const text = stdout.trim()
            if (!text) return done(null)
            try {
              done(JSON.parse(text) as T)
            } catch {
              done(null)
            }
          },
        )
      })
      .catch(() => done(null))
  })
}

/** Fire-and-forget PowerShell. Resolves to true when the exit code is 0. */
export function psRun(script: string, timeout = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      PS,
      [...BASE_ARGS, UTF8 + script],
      { timeout, windowsHide: true, encoding: 'utf8' },
      (err) => resolve(!err),
    )
  })
}

/** Escapes a value for a single-quoted PowerShell string literal. */
export function psq(value: string) {
  return value.replace(/'/g, "''")
}
