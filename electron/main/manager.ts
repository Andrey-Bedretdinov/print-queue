import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { stat } from 'node:fs/promises'
import type { AppState, Incident, Job, Printer, Settings } from '../../shared/types'
import type { ToastMessage } from '../../shared/ipc'
import { Simulator, isOpen } from './simulator'
import { ensureSamples } from './samples'
import { estimatePages } from './preview'
import { store } from './store'
import {
  readSystem,
  systemJobAction,
  systemPrintFile,
  systemPrinterAction,
} from './windows-source'

type Emit = (state: AppState) => void
type Toast = (toast: ToastMessage) => void

export class PrintManager {
  private sim = new Simulator()
  private sysPrinters: Printer[] = []
  private sysJobs: Job[] = []
  private sysSeen = new Map<string, Job['state']>()
  private systemAvailable = false
  private timer: NodeJS.Timeout | null = null
  private poller: NodeJS.Timeout | null = null
  private polling = false
  private dirty = true

  constructor(
    private emit: Emit,
    private toast: Toast,
  ) {
    this.sim.onFail = (job, printer) => this.openIncident(job, printer)
    this.sim.onComplete = (job) => this.resolveBySignature(job)
  }

  start() {
    this.sim.seed(ensureSamples())
    for (const job of this.sim.jobs) {
      if (job.state !== 'error') continue
      const printer = this.sim.printers.find((p) => p.id === job.printerId)
      if (printer) this.openIncident(job, printer)
    }
    this.timer = setInterval(() => {
      this.sim.tick()
      this.push()
    }, 250)
    this.pollSystem()
    this.poller = setInterval(() => this.pollSystem(), Math.max(1500, store.settings.pollMs))
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.poller) clearInterval(this.poller)
  }

  // ---------------------------------------------------------------- state

  state(): AppState {
    const printers = store.settings.simulation
      ? [...this.sim.printers.map(stripProfile), ...this.sysPrinters]
      : this.sysPrinters
    const jobs = store.settings.simulation ? [...this.sim.jobs, ...this.sysJobs] : this.sysJobs
    return {
      printers,
      jobs,
      incidents: store.incidents,
      settings: store.settings,
      systemAvailable: this.systemAvailable,
    }
  }

  push(force = false) {
    if (!force && !this.dirty) {
      // The simulator mutates in place every tick, so a push is always due while
      // anything is moving; otherwise skip to keep the renderer idle.
      const moving = this.sim.jobs.some((j) => j.state === 'printing')
      if (!moving) return
    }
    this.dirty = false
    this.emit(this.state())
  }

  private markDirty() {
    this.dirty = true
  }

  // --------------------------------------------------------------- system

  private async pollSystem() {
    if (this.polling) return
    this.polling = true
    try {
      const data = await readSystem()
      if (!data) {
        this.systemAvailable = false
        return
      }
      this.systemAvailable = true
      this.sysPrinters = data.printers
      this.sysJobs = data.jobs
      const alive = new Set<string>()
      for (const job of data.jobs) {
        alive.add(job.id)
        const prev = this.sysSeen.get(job.id)
        if (prev === job.state) continue
        this.sysSeen.set(job.id, job.state)
        if (job.state === 'error' && prev !== 'error') {
          const printer = data.printers.find((p) => p.id === job.printerId)
          if (printer) this.openIncident(job, printer)
        }
        if (job.state === 'completed' && prev && prev !== 'completed') {
          this.resolveBySignature(job)
        }
      }
      for (const id of [...this.sysSeen.keys()]) {
        if (!alive.has(id)) {
          // Jobs vanish from the spooler the moment they finish; a job that was
          // printing and disappeared without an error printed successfully.
          const prev = this.sysSeen.get(id)
          this.sysSeen.delete(id)
          if (prev === 'printing') {
            const gone = this.lastKnown.get(id)
            if (gone) this.resolveBySignature({ ...gone, state: 'completed' })
          }
        }
      }
      this.lastKnown = new Map(data.jobs.map((j) => [j.id, j]))
      this.markDirty()
      this.push(true)
    } finally {
      this.polling = false
    }
  }

  private lastKnown = new Map<string, Job>()

  // ------------------------------------------------------------ incidents

  private printerName(id: string) {
    return (
      this.sim.printers.find((p) => p.id === id)?.name ??
      this.sysPrinters.find((p) => p.id === id)?.name ??
      'Принтер'
    )
  }

  private openIncident(job: Job, printer: Printer) {
    const existing = store.incidents.find((i) => i.signature === job.signature && !i.resolved)
    if (existing) {
      existing.at = Date.now()
      existing.printerId = printer.id
      existing.printerName = printer.name
      existing.failure = job.failure ?? existing.failure
      existing.dismissed = false
      store.incidents = [...store.incidents]
    } else {
      const incident: Incident = {
        id: randomUUID(),
        signature: job.signature,
        jobName: job.name,
        ext: job.ext,
        path: job.path,
        pages: job.pages,
        printerId: printer.id,
        printerName: printer.name,
        failure: job.failure ?? 'driver_error',
        at: Date.now(),
        resolved: false,
        dismissed: false,
      }
      store.incidents = [incident, ...store.incidents].slice(0, 60)
      this.toast({
        id: incident.id,
        kind: 'error',
        text: job.name,
        sub: `Сбой на «${printer.name}»`,
      })
    }
    this.markDirty()
    this.push(true)
  }

  /** A document printed anywhere clears every open failure for that document. */
  private resolveBySignature(job: Job) {
    const open = store.incidents.filter((i) => i.signature === job.signature && !i.resolved)
    if (!open.length) return
    const printerName = this.printerName(job.printerId)
    for (const i of open) {
      i.resolved = true
      i.resolvedAt = Date.now()
      i.resolvedPrinterName = printerName
    }
    store.incidents = [...store.incidents]
    this.toast({
      id: randomUUID(),
      kind: 'ok',
      text: job.name,
      sub: `Напечатано на «${printerName}» — предупреждение снято`,
    })
    this.markDirty()
    this.push(true)
  }

  incidentAction(kind: string, id?: string, printerId?: string) {
    if (kind === 'dismiss' && id) {
      const inc = store.incidents.find((i) => i.id === id)
      if (inc) inc.dismissed = true
      store.incidents = [...store.incidents]
    } else if (kind === 'dismiss-all') {
      for (const i of store.incidents) i.dismissed = true
      store.incidents = [...store.incidents]
    } else if (kind === 'forget' && id) {
      store.incidents = store.incidents.filter((i) => i.id !== id)
    } else if (kind === 'reprint' && id) {
      const inc = store.incidents.find((i) => i.id === id)
      if (!inc) return false
      const target = printerId ?? inc.printerId
      void this.addFiles([inc.path ?? inc.jobName], target)
    }
    this.markDirty()
    this.push(true)
    return true
  }

  // -------------------------------------------------------------- actions

  async jobAction(jobId: string, kind: 'pause' | 'resume' | 'cancel' | 'retry' | 'top') {
    if (jobId.startsWith('sys:')) {
      if (kind === 'retry' || kind === 'top') return false
      const ok = await systemJobAction(jobId, kind)
      void this.pollSystem()
      return ok
    }
    const ok = this.sim.action(jobId, kind)
    this.markDirty()
    this.push(true)
    return ok
  }

  async moveJob(jobId: string, printerId: string, position: number) {
    const target =
      this.sim.printers.find((p) => p.id === printerId) ??
      this.sysPrinters.find((p) => p.id === printerId)
    if (!target) return { ok: false, reason: 'Принтер не найден' }

    if (jobId.startsWith('sys:')) {
      const job = this.sysJobs.find((j) => j.id === jobId)
      if (!job) return { ok: false, reason: 'Задание уже ушло из очереди' }
      if (!job.path) {
        return {
          ok: false,
          reason: 'Windows не отдаёт файл чужого задания — перенос невозможен',
        }
      }
      await systemJobAction(jobId, 'cancel')
      await systemPrintFile(job.path, target.name)
      void this.pollSystem()
      return { ok: true }
    }

    if (target.source === 'system') {
      const job = this.sim.jobs.find((j) => j.id === jobId)
      if (!job) return { ok: false, reason: 'Задание не найдено' }
      if (!job.path) return { ok: false, reason: 'У задания нет файла' }
      const printed = await systemPrintFile(job.path, target.name)
      if (!printed) return { ok: false, reason: 'Не удалось отправить на печать' }
      this.sim.action(jobId, 'cancel')
      void this.pollSystem()
      this.markDirty()
      this.push(true)
      return { ok: true }
    }

    const job = this.sim.move(jobId, printerId, position)
    this.markDirty()
    this.push(true)
    return job ? { ok: true } : { ok: false, reason: 'Задание не найдено' }
  }

  async printerAction(printerId: string, kind: 'pause' | 'resume' | 'clear' | 'fix' | 'toggle-power') {
    const sys = this.sysPrinters.find((p) => p.id === printerId)
    if (sys) {
      if (kind === 'fix' || kind === 'toggle-power') return false
      const ok = await systemPrinterAction(sys.name, kind)
      void this.pollSystem()
      return ok
    }
    const ok = this.sim.printerAction(printerId, kind)
    this.markDirty()
    this.push(true)
    return ok
  }

  async addFiles(paths: string[], printerId: string) {
    const target =
      this.sim.printers.find((p) => p.id === printerId) ??
      this.sysPrinters.find((p) => p.id === printerId)
    if (!target) return { ok: false, added: 0 }
    let added = 0
    for (const path of paths) {
      let bytes = 0
      try {
        bytes = (await stat(path)).size
      } catch {
        continue
      }
      if (target.source === 'system') {
        const sent = await systemPrintFile(path, target.name)
        if (sent) added += 1
        continue
      }
      const pages = await estimatePages(path, bytes)
      this.sim.add(printerId, { name: basename(path), path, bytes, pages })
      added += 1
    }
    if (target.source === 'system') void this.pollSystem()
    this.markDirty()
    this.push(true)
    return { ok: added > 0, added }
  }

  updateSettings(patch: Partial<Settings>) {
    const next = store.patchSettings(patch)
    if (patch.pollMs && this.poller) {
      clearInterval(this.poller)
      this.poller = setInterval(() => this.pollSystem(), Math.max(1500, next.pollMs))
    }
    this.markDirty()
    this.push(true)
    return next
  }
}

function stripProfile(p: Printer & { profile?: unknown; outage?: unknown }): Printer {
  const { profile: _profile, outage: _outage, ...rest } = p
  return rest
}

export { isOpen }
