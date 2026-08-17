import { basename } from 'node:path'
import { extOf, type Consumable, type Job, type JobFailure, type Printer } from '../../shared/types'
import { signatureOf } from './signature'

interface Profile {
  /** Chance per second that an active job hits a hardware problem. */
  failureRate: number
  /** Chance per second that a network printer drops off the network. */
  dropRate: number
  failures: Array<[JobFailure, number]>
}

interface SimPrinter extends Printer {
  profile: Profile
  /** Seconds left of a transient offline period. */
  outage: number
}

const ink = (id: string, label: string, level: number, color: string): Consumable => ({
  id,
  label,
  level,
  color,
})

let seq = 0
const nextId = (p: string) => `${p}${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`

function makePrinters(): SimPrinter[] {
  return [
    {
      id: 'sim:hp-m404',
      name: 'HP LaserJet Pro M404dn',
      model: 'HP LaserJet Pro M404dn',
      connection: 'network',
      address: '192.168.0.51',
      state: 'ready',
      source: 'sim',
      paused: false,
      default: false,
      color: false,
      duplex: true,
      consumables: [ink('k', 'Тонер', 64, '#4b4b4b')],
      tray: 320,
      speed: 38,
      profile: {
        failureRate: 0.004,
        dropRate: 0.0006,
        failures: [
          ['paper_jam', 3],
          ['out_of_paper', 3],
          ['out_of_toner', 1],
          ['driver_error', 1],
        ],
      },
      outage: 0,
    },
    {
      id: 'sim:canon-ts8340',
      name: 'Canon PIXMA TS8340',
      model: 'Canon PIXMA TS8340',
      connection: 'usb',
      address: 'USB001',
      state: 'ready',
      source: 'sim',
      paused: false,
      default: true,
      color: true,
      duplex: true,
      consumables: [
        ink('c', 'C', 71, '#00a3c8'),
        ink('m', 'M', 44, '#d6489a'),
        ink('y', 'Y', 82, '#e8b93a'),
        ink('k', 'K', 23, '#4b4b4b'),
      ],
      tray: 180,
      speed: 15,
      profile: {
        failureRate: 0.006,
        dropRate: 0,
        failures: [
          ['out_of_paper', 4],
          ['paper_jam', 2],
          ['out_of_toner', 2],
        ],
      },
      outage: 0,
    },
    {
      id: 'sim:kyocera-p3145',
      name: 'Kyocera ECOSYS P3145dn',
      model: 'Kyocera ECOSYS P3145dn',
      connection: 'network',
      address: '192.168.0.77',
      state: 'ready',
      source: 'sim',
      paused: false,
      default: false,
      color: false,
      duplex: true,
      consumables: [ink('k', 'Тонер', 9, '#4b4b4b')],
      tray: 500,
      speed: 45,
      profile: {
        failureRate: 0.012,
        dropRate: 0.001,
        failures: [
          ['paper_jam', 4],
          ['out_of_toner', 3],
          ['spool_error', 1],
        ],
      },
      outage: 0,
    },
    {
      id: 'sim:zebra-zd421',
      name: 'Zebra ZD421',
      model: 'Zebra ZD421 203dpi',
      connection: 'usb',
      address: 'USB003',
      state: 'ready',
      source: 'sim',
      paused: false,
      default: false,
      color: false,
      duplex: false,
      consumables: [ink('r', 'Лента', 37, '#4b4b4b')],
      tray: 1200,
      speed: 60,
      profile: {
        failureRate: 0.008,
        dropRate: 0,
        failures: [
          ['out_of_paper', 3],
          ['driver_error', 2],
        ],
      },
      outage: 0,
    },
  ]
}

function weightedPick(pairs: Array<[JobFailure, number]>): JobFailure {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * total
  for (const [value, w] of pairs) {
    r -= w
    if (r <= 0) return value
  }
  return pairs[0][0]
}

export interface JobSeed {
  name: string
  path?: string
  bytes: number
  pages: number
  copies?: number
  owner?: string
  state?: Job['state']
  failure?: JobFailure
}

/**
 * Deterministic-enough fake print farm. Every printer runs its own head-of-queue
 * job, burns consumables and occasionally breaks in a way the UI has to survive.
 */
export class Simulator {
  printers = makePrinters()
  jobs: Job[] = []
  private last = Date.now()

  onComplete: ((job: Job, printer: Printer) => void) | null = null
  onFail: ((job: Job, printer: Printer) => void) | null = null

  seed(files: JobSeed[]) {
    if (!files.length) return
    // Первые пять файлов — снимки: на цветной Canon уходят они, на лазерные —
    // документы. Так эмуляция показывает и миниатюры, и предпросмотр.
    const plan: Array<[string, number, Job['state']?, JobFailure?]> = [
      ['sim:canon-ts8340', 0],
      ['sim:canon-ts8340', 1],
      ['sim:canon-ts8340', 2],
      ['sim:hp-m404', 3],
      ['sim:hp-m404', 5],
      ['sim:hp-m404', 6],
      ['sim:kyocera-p3145', 7, 'error', 'paper_jam'],
      ['sim:kyocera-p3145', 8],
      ['sim:zebra-zd421', 9],
      ['sim:zebra-zd421', 4],
    ]
    for (const [printerId, idx, state, failure] of plan) {
      const file = files[idx % files.length]
      const job = this.add(printerId, file)
      if (state) {
        job.state = state
        job.failure = failure
        job.printedPages = failure ? Math.max(1, Math.floor(job.pages / 3)) : 0
        const printer = this.printers.find((p) => p.id === printerId)
        if (printer && failure) {
          printer.state = 'error'
          printer.detail = DETAIL[failure]
        }
      }
    }
  }

  add(printerId: string, seed: JobSeed, atIndex?: number): Job {
    const name = basename(seed.name)
    const job: Job = {
      id: nextId('j'),
      printerId,
      name,
      ext: extOf(name),
      path: seed.path,
      bytes: seed.bytes,
      pages: Math.max(1, seed.pages),
      printedPages: 0,
      copies: seed.copies ?? 1,
      owner: seed.owner ?? 'Вы',
      state: seed.state ?? 'queued',
      failure: seed.failure,
      submittedAt: Date.now(),
      signature: signatureOf(name, seed.bytes, Math.max(1, seed.pages)),
      source: 'sim',
      retries: 0,
    }
    if (atIndex === undefined) this.jobs.push(job)
    else this.jobs.splice(this.indexInPrinter(printerId, atIndex), 0, job)
    return job
  }

  /** Translates a per-printer position into an index in the flat job array. */
  private indexInPrinter(printerId: string, position: number) {
    const ids = this.jobs.filter((j) => j.printerId === printerId && isOpen(j))
    const target = ids[Math.min(position, Math.max(0, ids.length - 1))]
    if (!target || position >= ids.length) {
      const last = ids[ids.length - 1]
      return last ? this.jobs.indexOf(last) + 1 : this.jobs.length
    }
    return this.jobs.indexOf(target)
  }

  move(jobId: string, printerId: string, position: number) {
    const idx = this.jobs.findIndex((j) => j.id === jobId)
    if (idx < 0) return null
    const [job] = this.jobs.splice(idx, 1)
    const from = job.printerId
    if (from !== printerId) {
      job.movedFrom = from
      job.printedPages = 0
      if (job.state === 'printing' || job.state === 'error') job.state = 'queued'
      job.failure = undefined
    }
    job.printerId = printerId
    this.jobs.splice(this.indexInPrinter(printerId, position), 0, job)
    return job
  }

  action(jobId: string, kind: 'pause' | 'resume' | 'cancel' | 'retry' | 'top') {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) return false
    if (kind === 'pause' && (job.state === 'queued' || job.state === 'printing')) job.state = 'paused'
    else if (kind === 'resume' && job.state === 'paused') job.state = 'queued'
    else if (kind === 'cancel') {
      job.state = 'canceled'
      job.finishedAt = Date.now()
    } else if (kind === 'retry') {
      job.state = 'queued'
      job.failure = undefined
      job.printedPages = 0
      job.retries += 1
    } else if (kind === 'top') {
      this.move(job.id, job.printerId, 0)
    }
    return true
  }

  printerAction(printerId: string, kind: 'pause' | 'resume' | 'clear' | 'fix' | 'toggle-power') {
    const p = this.printers.find((x) => x.id === printerId)
    if (!p) return false
    if (kind === 'pause') p.paused = true
    else if (kind === 'resume') p.paused = false
    else if (kind === 'clear') {
      for (const j of this.jobs) {
        if (j.printerId === printerId && isOpen(j)) {
          j.state = 'canceled'
          j.finishedAt = Date.now()
        }
      }
    } else if (kind === 'fix') {
      p.state = 'ready'
      p.detail = undefined
      p.outage = 0
      for (const c of p.consumables) if (c.level < 5) c.level = 100
      if (p.tray < 20) p.tray = 250
      for (const j of this.jobs) {
        if (j.printerId === printerId && j.state === 'error') {
          j.state = 'queued'
          j.failure = undefined
        }
      }
    } else if (kind === 'toggle-power') {
      if (p.state === 'offline') {
        p.state = 'ready'
        p.detail = undefined
        p.outage = 0
      } else {
        p.state = 'offline'
        p.detail = 'Выключен'
        p.outage = Infinity
      }
    }
    return true
  }

  tick() {
    const now = Date.now()
    const dt = Math.min(2, (now - this.last) / 1000)
    this.last = now
    if (dt <= 0) return

    for (const p of this.printers) {
      // A printer only stays broken while a broken job is still sitting on it —
      // dragging that job elsewhere or cancelling it clears the condition.
      if (p.state === 'error') {
        const stuck = this.jobs.some((j) => j.printerId === p.id && j.state === 'error')
        const dry = p.tray <= 0 || p.consumables.some((c) => c.level <= 0)
        if (!stuck && !dry) {
          p.state = 'ready'
          p.detail = undefined
        }
      }
      if (p.outage > 0 && p.outage !== Infinity) {
        p.outage -= dt
        if (p.outage <= 0) {
          p.outage = 0
          p.state = 'ready'
          p.detail = undefined
        }
      }
      if (p.state === 'offline') continue
      if (p.connection === 'network' && Math.random() < p.profile.dropRate * dt) {
        p.state = 'offline'
        p.detail = 'Потеряна связь'
        p.outage = 8 + Math.random() * 14
        const active = this.jobs.find((j) => j.printerId === p.id && j.state === 'printing')
        if (active) this.fail(active, p, 'offline')
        continue
      }
      if (p.paused) {
        p.state = 'paused'
        continue
      }
      if (p.state === 'error') continue

      const job = this.jobs.find(
        (j) => j.printerId === p.id && (j.state === 'printing' || j.state === 'queued'),
      )
      if (!job) {
        p.state = 'ready'
        p.detail = undefined
        continue
      }
      if (job.state === 'queued') {
        job.state = 'printing'
        job.startedAt = now
      }
      p.state = 'printing'
      p.detail = undefined

      if (Math.random() < p.profile.failureRate * dt) {
        this.fail(job, p, weightedPick(p.profile.failures))
        continue
      }

      const total = job.pages * job.copies
      job.printedPages = Math.min(total, job.printedPages + (p.speed / 60) * dt)

      const sheets = (p.speed / 60) * dt
      p.tray = Math.max(0, p.tray - sheets)
      for (const c of p.consumables) c.level = Math.max(0, c.level - sheets * 0.055)

      if (p.tray <= 0) {
        this.fail(job, p, 'out_of_paper')
        continue
      }
      const dry = p.consumables.find((c) => c.level <= 0)
      if (dry) {
        this.fail(job, p, 'out_of_toner')
        continue
      }

      if (job.printedPages >= total - 0.001) {
        job.printedPages = total
        job.state = 'completed'
        job.finishedAt = now
        p.state = 'ready'
        this.onComplete?.(job, p)
      }
    }

    // Keep finished work around briefly so the UI can animate it away.
    const cutoff = now - 45_000
    this.jobs = this.jobs.filter(
      (j) => isOpen(j) || j.state === 'error' || (j.finishedAt ?? now) > cutoff,
    )
  }

  private fail(job: Job, printer: SimPrinter, failure: JobFailure) {
    job.state = 'error'
    job.failure = failure
    printer.state = failure === 'offline' ? 'offline' : 'error'
    printer.detail = DETAIL[failure]
    if (failure === 'out_of_paper') printer.tray = 0
    this.onFail?.(job, printer)
  }
}

const DETAIL: Record<JobFailure, string> = {
  paper_jam: 'Замятие бумаги',
  out_of_paper: 'Нет бумаги',
  out_of_toner: 'Закончился тонер',
  offline: 'Нет связи',
  driver_error: 'Ошибка драйвера',
  spool_error: 'Ошибка спулера',
  canceled_by_printer: 'Сброшено принтером',
}

export function isOpen(job: Job) {
  return job.state === 'queued' || job.state === 'printing' || job.state === 'paused'
}
