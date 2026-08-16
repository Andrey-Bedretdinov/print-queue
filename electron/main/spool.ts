import { psJson, psq } from './powershell'

/**
 * Перенос чужого задания между принтерами.
 *
 * Windows не умеет переносить задание из очереди в очередь, но данные задания
 * лежат на диске: %SystemRoot%\System32\spool\PRINTERS\<id>.SPL. Мы ставим
 * задание на паузу, читаем спул-файл, заводим новое задание на целевом принтере
 * через AddJob (он возвращает путь, куда положить данные), выставляем исходный
 * тип данных и расписываем его ScheduleJob, а исходное удаляем.
 *
 * Работает, когда оба принтера используют один драйвер — для парка одинаковых
 * машин это обычный случай. Чтение спул-каталога требует прав администратора.
 */

const HELPER = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class PQSpool
{
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool AddJob(IntPtr handle, uint level, IntPtr data, uint size, out uint needed);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ScheduleJob(IntPtr handle, uint jobId);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetJob(IntPtr handle, uint jobId, uint level, IntPtr data, uint size, out uint needed);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetJob(IntPtr handle, uint jobId, uint level, IntPtr data, uint command);

    [StructLayout(LayoutKind.Sequential)]
    struct SYSTEMTIME { public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Ms; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct JOB_INFO_1
    {
        public uint JobId;
        public IntPtr pPrinterName;
        public IntPtr pMachineName;
        public IntPtr pUserName;
        public IntPtr pDocument;
        public IntPtr pDatatype;
        public IntPtr pStatus;
        public uint Status, Priority, Position, TotalPages, PagesPrinted;
        public SYSTEMTIME Submitted;
    }

    const uint JOB_CONTROL_PAUSE = 1;
    const uint JOB_CONTROL_DELETE = 5;

    static IntPtr Open(string printer)
    {
        IntPtr h;
        if (!OpenPrinter(printer, out h, IntPtr.Zero))
            throw new Exception("open-printer:" + Marshal.GetLastWin32Error());
        return h;
    }

    static IntPtr JobBuffer(IntPtr handle, uint jobId, out uint size)
    {
        uint needed;
        GetJob(handle, jobId, 1, IntPtr.Zero, 0, out needed);
        if (needed == 0) throw new Exception("job-gone:" + Marshal.GetLastWin32Error());
        IntPtr buf = Marshal.AllocHGlobal((int)needed);
        if (!GetJob(handle, jobId, 1, buf, needed, out needed))
            throw new Exception("get-job:" + Marshal.GetLastWin32Error());
        size = needed;
        return buf;
    }

    public static string Move(string source, uint jobId, string target, string spoolDir)
    {
        IntPtr src = Open(source);
        string datatype, document;
        try
        {
            uint size;
            IntPtr buf = JobBuffer(src, jobId, out size);
            JOB_INFO_1 info = (JOB_INFO_1)Marshal.PtrToStructure(buf, typeof(JOB_INFO_1));
            datatype = Marshal.PtrToStringUni(info.pDatatype);
            document = Marshal.PtrToStringUni(info.pDocument);
            Marshal.FreeHGlobal(buf);

            SetJob(src, jobId, 0, IntPtr.Zero, JOB_CONTROL_PAUSE);

            string spl = Path.Combine(spoolDir, jobId.ToString("00000") + ".SPL");
            if (!File.Exists(spl)) throw new Exception("no-spool-file");
            byte[] data = File.ReadAllBytes(spl);
            if (data.Length == 0) throw new Exception("empty-spool-file");

            IntPtr dst = Open(target);
            try
            {
                uint needed;
                AddJob(dst, 1, IntPtr.Zero, 0, out needed);
                if (needed == 0) throw new Exception("add-job:" + Marshal.GetLastWin32Error());
                IntPtr add = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!AddJob(dst, 1, add, needed, out needed))
                        throw new Exception("add-job:" + Marshal.GetLastWin32Error());
                    IntPtr pathPtr = Marshal.ReadIntPtr(add);
                    uint newId = (uint)Marshal.ReadInt32(add, IntPtr.Size);
                    string outPath = Marshal.PtrToStringUni(pathPtr);
                    File.WriteAllBytes(outPath, data);

                    uint size2;
                    IntPtr buf2 = JobBuffer(dst, newId, out size2);
                    JOB_INFO_1 fresh = (JOB_INFO_1)Marshal.PtrToStructure(buf2, typeof(JOB_INFO_1));
                    fresh.pDatatype = Marshal.StringToHGlobalUni(datatype);
                    fresh.pDocument = Marshal.StringToHGlobalUni(document);
                    fresh.pStatus = IntPtr.Zero;
                    Marshal.StructureToPtr(fresh, buf2, false);
                    SetJob(dst, newId, 1, buf2, 0);

                    if (!ScheduleJob(dst, newId))
                        throw new Exception("schedule:" + Marshal.GetLastWin32Error());

                    SetJob(src, jobId, 0, IntPtr.Zero, JOB_CONTROL_DELETE);
                    return "{\\"ok\\":true,\\"jobId\\":" + newId + ",\\"datatype\\":\\"" + datatype + "\\"}";
                }
                finally { Marshal.FreeHGlobal(add); }
            }
            finally { ClosePrinter(dst); }
        }
        finally { ClosePrinter(src); }
    }
}
"@

try {
  [PQSpool]::Move('__SRC__', __JOB__, '__DST__', '__DIR__')
} catch {
  $m = $_.Exception.Message
  if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
  ConvertTo-Json -Compress ([pscustomobject]@{ ok = $false; error = $m })
}
`

export interface SpoolMoveResult {
  ok: boolean
  jobId?: number
  datatype?: string
  error?: string
}

const REASON: Record<string, string> = {
  'no-spool-file': 'Windows уже отдал задание на принтер — переносить нечего',
  'empty-spool-file': 'Спул-файл задания пуст',
  'job-gone:0': 'Задание уже ушло из очереди',
}

export function explain(error?: string) {
  if (!error) return 'Не удалось перенести задание'
  if (REASON[error]) return REASON[error]
  if (error.startsWith('job-gone')) return 'Задание уже ушло из очереди'
  if (error.includes('Access') || error.includes('доступ') || error.startsWith('open-printer:5')) {
    return 'Нужны права администратора'
  }
  if (error.startsWith('add-job:')) return 'Целевой принтер не принял задание'
  if (error.startsWith('schedule:')) return 'Не удалось поставить задание в очередь'
  return error
}

/** true, если спул-каталог читается — то есть перенос чужих заданий доступен. */
export async function canMoveSystemJobs() {
  const res = await psJson<{ ok: boolean }>(
    `try { $null = Get-ChildItem -Force -ErrorAction Stop (Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS'); ` +
      `ConvertTo-Json -Compress ([pscustomobject]@{ ok = $true }) } ` +
      `catch { ConvertTo-Json -Compress ([pscustomobject]@{ ok = $false }) }`,
    8000,
  )
  return !!res?.ok
}

export async function moveSpoolJob(
  source: string,
  jobId: number,
  target: string,
): Promise<SpoolMoveResult> {
  const dir = await spoolDir()
  const script = HELPER.replace('__SRC__', psq(source))
    .replace('__JOB__', String(jobId))
    .replace('__DST__', psq(target))
    .replace('__DIR__', psq(dir))
  const res = await psJson<SpoolMoveResult>(script, 30000)
  return res ?? { ok: false, error: 'helper-failed' }
}

let cachedDir = ''

async function spoolDir() {
  if (cachedDir) return cachedDir
  const res = await psJson<{ dir: string }>(
    `$d = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers' -Name DefaultSpoolDirectory -ErrorAction SilentlyContinue).DefaultSpoolDirectory; ` +
      `if (-not $d) { $d = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS' }; ` +
      `ConvertTo-Json -Compress ([pscustomobject]@{ dir = $d })`,
  )
  cachedDir = res?.dir || 'C:\\Windows\\System32\\spool\\PRINTERS'
  return cachedDir
}
