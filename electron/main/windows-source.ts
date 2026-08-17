import { psJson, psRun, psq } from './powershell'
import { extOf, type ConnectionKind, type Job, type JobFailure, type Printer, type PrinterState } from '../../shared/types'
import { signatureOf } from './signature'
import { pathForJob, rememberPrinted } from './origins'

interface RawPrinter {
  Name: string
  DriverName: string
  PortName: string
  Location: string | null
  Comment: string | null
  Default: boolean
  Attributes: number
  WorkOffline: boolean
  PrinterState: number
  PrinterStatus: number
  DetectedErrorState: number
  Capabilities: number[] | null
  HostAddress: string | null
  PortDescription: string | null
}

interface RawJob {
  JobId: number
  Printer: string
  Document: string
  Owner: string
  Pages: number
  PagesPrinted: number
  Size: number
  StatusMask: number
  JobStatus: string | null
  Submitted: number
}

/**
 * One PowerShell round-trip for everything: printers, their TCP/IP ports and
 * every spooled job. Polling three separate cmdlets was visibly slower.
 */
export const SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$ports = @{}
foreach ($p in (Get-CimInstance Win32_TCPIPPrinterPort)) { $ports[$p.Name] = $p.HostAddress }
$portDesc = @{}
foreach ($p in (Get-CimInstance Win32_PrinterPort)) { $portDesc[$p.Name] = $p.Description }
$printers = @(Get-CimInstance Win32_Printer | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    DriverName = $_.DriverName
    PortName = $_.PortName
    Location = $_.Location
    Comment = $_.Comment
    Default = [bool]$_.Default
    Attributes = [int]$_.Attributes
    WorkOffline = [bool]$_.WorkOffline
    PrinterState = [int]$_.PrinterState
    PrinterStatus = [int]$_.PrinterStatus
    DetectedErrorState = [int]$_.DetectedErrorState
    Capabilities = @($_.Capabilities)
    HostAddress = $ports[$_.PortName]
    PortDescription = $portDesc[$_.PortName]
  }
})
$jobs = @(Get-CimInstance Win32_PrintJob | ForEach-Object {
  $ts = 0
  if ($_.TimeSubmitted) { $ts = [int64](([datetime]$_.TimeSubmitted).ToUniversalTime() - (Get-Date '1970-01-01Z').ToUniversalTime()).TotalMilliseconds }
  # Name is "<printer>, <job id>" and a printer name may itself contain a comma.
  $cut = $_.Name.LastIndexOf(',')
  [pscustomobject]@{
    JobId = [int]$_.JobId
    Printer = $(if ($cut -gt 0) { $_.Name.Substring(0, $cut) } else { $_.Name })
    Document = $_.Document
    Owner = $_.Owner
    Pages = [int]$_.TotalPages
    PagesPrinted = [int]$_.PagesPrinted
    Size = [int64]$_.Size
    StatusMask = [int]$_.StatusMask
    JobStatus = $_.JobStatus
    Submitted = $ts
  }
})
[pscustomobject]@{ printers = $printers; jobs = $jobs } | ConvertTo-Json -Depth 4 -Compress
`

const MASK = {
  paused: 1,
  error: 2,
  deleting: 4,
  spooling: 8,
  printing: 16,
  offline: 32,
  paperout: 64,
  printed: 128,
  deleted: 256,
  blocked: 512,
  intervention: 1024,
  restart: 2048,
  complete: 4096,
} as const

export function connectionOf(portName: string, host: string | null, description: string | null): ConnectionKind {
  const port = (portName || '').toUpperCase()
  if (host) return 'network'
  if (port.startsWith('USB') || port.startsWith('DOT4') || port.startsWith('LPT') || port.startsWith('COM')) return 'usb'
  if (port.startsWith('WSD') || port.startsWith('IP_') || /^\d{1,3}(\.\d{1,3}){3}/.test(port)) return 'network'
  if ((description || '').toUpperCase().includes('WSD')) return 'network'
  if (port === 'NUL:' || port === 'PORTPROMPT:' || port.includes('PDF') || port.includes('XPS')) return 'virtual'
  return 'usb'
}

function errorState(code: number): { state: PrinterState; detail?: string; failure?: JobFailure } {
  switch (code) {
    case 3:
      return { state: 'warning', detail: 'Мало бумаги' }
    case 4:
      return { state: 'error', detail: 'Нет бумаги', failure: 'out_of_paper' }
    case 5:
      return { state: 'warning', detail: 'Мало тонера' }
    case 6:
      return { state: 'error', detail: 'Нет тонера', failure: 'out_of_toner' }
    case 7:
      return { state: 'error', detail: 'Открыта крышка', failure: 'driver_error' }
    case 8:
      return { state: 'error', detail: 'Замятие', failure: 'paper_jam' }
    case 9:
      return { state: 'offline', detail: 'Не в сети', failure: 'offline' }
    case 10:
      return { state: 'warning', detail: 'Требуется обслуживание' }
    case 11:
      return { state: 'warning', detail: 'Лоток заполнен' }
    default:
      return { state: 'ready' }
  }
}

export function idFor(name: string) {
  return 'sys:' + name.replace(/[^\w.-]+/g, '_').toLowerCase()
}

export interface RawSnapshot {
  printers: RawPrinter[] | RawPrinter
  jobs: RawJob[] | RawJob
}

export async function readSystem(): Promise<{ printers: Printer[]; jobs: Job[] } | null> {
  const raw = await psJson<RawSnapshot>(SCRIPT, 25000)
  return raw ? parseSystem(raw) : null
}

export function parseSystem(raw: RawSnapshot): { printers: Printer[]; jobs: Job[] } {
  const rawPrinters = raw.printers ? (Array.isArray(raw.printers) ? raw.printers : [raw.printers]) : []
  const rawJobs = raw.jobs ? (Array.isArray(raw.jobs) ? raw.jobs : [raw.jobs]) : []

  const printers: Printer[] = rawPrinters.map((p) => {
    const err = errorState(p.DetectedErrorState)
    const paused = p.PrinterState === 1 || p.PrinterStatus === 6
    let state: PrinterState = err.state
    if (p.WorkOffline) state = 'offline'
    else if (paused) state = 'paused'
    else if (state === 'ready' && p.PrinterStatus === 4) state = 'printing'
    else if (state === 'ready' && p.PrinterStatus === 7) state = 'offline'
    const caps = p.Capabilities ?? []
    const connection = connectionOf(p.PortName, p.HostAddress, p.PortDescription)
    return {
      id: idFor(p.Name),
      name: p.Name,
      model: p.DriverName || p.Name,
      connection,
      address: p.HostAddress || p.PortName,
      state,
      detail: err.detail,
      source: 'system',
      paused,
      default: !!p.Default,
      color: caps.includes(2),
      duplex: caps.includes(4),
      // PRINTER_ATTRIBUTE_DIRECT — печать мимо очереди, спул-файла не будет.
      direct: ((p.Attributes | 0) & 0x2) !== 0,
      consumables: [],
      tray: 0,
      speed: 0,
    }
  })

  const jobs: Job[] = rawJobs.map((j) => {
    const mask = j.StatusMask | 0
    let state: Job['state'] = 'queued'
    let failure: JobFailure | undefined
    if (mask & MASK.printing) state = 'printing'
    if (mask & MASK.spooling) state = 'queued'
    if (mask & MASK.paused) state = 'paused'
    if (mask & (MASK.printed | MASK.complete)) state = 'completed'
    if (mask & (MASK.deleted | MASK.deleting)) state = 'canceled'
    if (mask & MASK.error) {
      state = 'error'
      failure = 'driver_error'
    }
    if (mask & MASK.paperout) {
      state = 'error'
      failure = 'out_of_paper'
    }
    if (mask & MASK.offline) {
      state = 'error'
      failure = 'offline'
    }
    if (mask & (MASK.blocked | MASK.intervention)) {
      state = 'error'
      failure = failure ?? 'spool_error'
    }
    const name = j.Document || `Задание ${j.JobId}`
    const ext = extOf(name)
    return {
      id: `sys:${j.Printer}:${j.JobId}`,
      printerId: idFor(j.Printer),
      name,
      ext,
      // Спулер путь не хранит, но печать через приложение мы помним сами.
      path: pathForJob(name),
      bytes: Number(j.Size) || 0,
      pages: Math.max(1, j.Pages || 1),
      printedPages: j.PagesPrinted || 0,
      copies: 1,
      owner: j.Owner || '',
      state,
      failure,
      submittedAt: j.Submitted || Date.now(),
      signature: signatureOf(name, Number(j.Size) || 0, Math.max(1, j.Pages || 1)),
      source: 'system',
      retries: 0,
    }
  })

  return { printers, jobs }
}

/** Job ids are `sys:<printer name>:<job id>`; the name itself may contain ':'. */
export function jobRef(jobId: string) {
  const body = jobId.slice(4)
  const cut = body.lastIndexOf(':')
  return { printer: body.slice(0, cut), id: Number(body.slice(cut + 1)) }
}

export async function systemJobAction(jobId: string, kind: 'pause' | 'resume' | 'cancel') {
  const { printer, id } = jobRef(jobId)
  const cmd =
    kind === 'pause' ? 'Suspend-PrintJob' : kind === 'resume' ? 'Resume-PrintJob' : 'Remove-PrintJob'
  return psRun(`${cmd} -PrinterName '${psq(printer)}' -ID ${id}`)
}

export async function systemPrinterAction(name: string, kind: 'pause' | 'resume' | 'clear') {
  if (kind === 'clear') {
    return psRun(
      `Get-PrintJob -PrinterName '${psq(name)}' | Remove-PrintJob -Confirm:$false`,
    )
  }
  const method = kind === 'pause' ? 'Pause' : 'Resume'
  return psRun(
    `$p = Get-CimInstance Win32_Printer -Filter "Name='${psq(name).replace(/"/g, '')}'"; ` +
      `if (-not $p) { exit 1 }; ` +
      `$null = Invoke-CimMethod -InputObject $p -MethodName ${method}`,
  )
}

/**
 * Готовит принтер к переносу заданий:
 *   0x2   DIRECT            — печать мимо очереди, снимаем;
 *   0x200 DO_COMPLETE_FIRST — печатать после полного помещения в очередь;
 *   0x100 KEEPPRINTEDJOBS   — сохранять файл задания после печати, иначе
 *                             спулер стирает его сразу и переносить нечего.
 */
export async function enableSpooling(name: string) {
  const filter = psq(name).replace(/"/g, '')
  return psRun(
    `$p = Get-CimInstance Win32_Printer -Filter "Name='${filter}'"; ` +
      `if (-not $p) { exit 1 }; ` +
      `$p.Attributes = (([int]$p.Attributes -bor 0x200 -bor 0x100) -band (-bnot 0x2)); ` +
      `Set-CimInstance -InputObject $p -ErrorAction Stop`,
  )
}

/**
 * Сохранение напечатанного нужно только для переноса, поэтому очередь чистится
 * сама — но лишь у принтеров, которым приложение это сохранение включило.
 */
export async function purgePrintedJobs(printers: string[]) {
  if (!printers.length) return true
  const list = printers.map((n) => `'${psq(n)}'`).join(',')
  return psRun(
    `$names = @(${list}); $cut = (Get-Date).AddMinutes(-5); ` +
      `Get-CimInstance Win32_PrintJob | ` +
      `Where-Object { ($_.StatusMask -band 0x80) -and $_.TimeSubmitted -and ([datetime]$_.TimeSubmitted) -lt $cut } | ` +
      `Where-Object { $job = $_; @($names | Where-Object { $job.Name.StartsWith($_ + ',') }).Count -gt 0 } | ` +
      `ForEach-Object { $null = Invoke-CimMethod -InputObject $_ -MethodName Delete }`,
    20000,
  )
}

export async function renameSystemPrinter(oldName: string, newName: string) {
  return psRun(`Rename-Printer -Name '${psq(oldName)}' -NewName '${psq(newName)}' -ErrorAction Stop`)
}

/** Sends a file to a named printer through the shell's PrintTo verb. */
export async function systemPrintFile(filePath: string, printerName: string) {
  rememberPrinted(filePath)
  return psRun(
    `Start-Process -FilePath '${psq(filePath)}' -Verb PrintTo -ArgumentList '"${psq(printerName).replace(/"/g, '')}"' -WindowStyle Hidden`,
    20000,
  )
}
