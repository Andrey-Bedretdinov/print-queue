import { BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Development-only remote control, enabled with PQ_DEV_CTRL=<dir>.
 * Drop a JSON command file into the directory and the running window executes
 * it — used to script UI checks and capture real screenshots while iterating.
 * Never active in a normal launch.
 */
export function attach(win: BrowserWindow, dir: string) {
  const cmdFile = join(dir, 'cmd.json')
  const outFile = join(dir, 'out.json')
  let last = 0

  setInterval(async () => {
    if (!existsSync(cmdFile)) return
    const mtime = statSync(cmdFile).mtimeMs
    if (mtime === last) return
    last = mtime
    let cmd: {
      js?: string
      shot?: string
      wait?: number
      mouse?: Array<{ t: 'move' | 'down' | 'up'; x?: number; y?: number; d?: number }>
    } = {}
    try {
      cmd = JSON.parse(readFileSync(cmdFile, 'utf8'))
    } catch {
      return
    }
    const result: Record<string, unknown> = {}
    try {
      if (cmd.js) result.js = await win.webContents.executeJavaScript(cmd.js, true)
      if (cmd.mouse) {
        let x = 0
        let y = 0
        for (const step of cmd.mouse) {
          x = step.x ?? x
          y = step.y ?? y
          win.webContents.sendInputEvent({
            type: step.t === 'down' ? 'mouseDown' : step.t === 'up' ? 'mouseUp' : 'mouseMove',
            x,
            y,
            button: 'left',
            clickCount: 1,
          })
          await new Promise((r) => setTimeout(r, step.d ?? 60))
        }
      }
      if (cmd.wait) await new Promise((r) => setTimeout(r, cmd.wait))
      if (cmd.shot) {
        const image = await win.webContents.capturePage()
        writeFileSync(cmd.shot, image.toPNG())
        result.shot = cmd.shot
      }
      result.ok = true
    } catch (err) {
      result.ok = false
      result.error = String(err)
    }
    writeFileSync(outFile, JSON.stringify(result), 'utf8')
    try {
      unlinkSync(cmdFile)
      last = 0
    } catch {
      /* keep polling */
    }
  }, 200)
}
