import { app } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
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
    const uint JOB_CONTROL_RESUME = 2;
    const uint JOB_CONTROL_DELETE = 5;

    /** Что реально лежит в каталогах — попадает в журнал, когда файл не найден. */
    public static string Describe(string dirs)
    {
        System.Text.StringBuilder sb = new System.Text.StringBuilder();
        foreach (string dir in dirs.Split(';'))
        {
            if (dir.Length == 0) continue;
            sb.Append("|").Append(dir).Append(" ");
            if (!Directory.Exists(dir)) { sb.Append("нет каталога"); continue; }
            try
            {
                string[] all = Directory.GetFiles(dir);
                sb.Append(all.Length).Append(" файлов");
                int n = 0;
                foreach (string f in all)
                {
                    if (n++ >= 20) { sb.Append(" ..."); break; }
                    sb.Append(" ").Append(Path.GetFileName(f));
                }
            }
            catch (Exception e) { sb.Append("ошибка чтения: ").Append(e.GetType().Name); }
        }
        return sb.ToString();
    }

    static byte[] Head(string file, int max)
    {
        using (FileStream fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            int len = (int)Math.Min(max, fs.Length);
            byte[] buf = new byte[len];
            int done = 0;
            while (done < len)
            {
                int n = fs.Read(buf, done, len - done);
                if (n <= 0) break;
                done += n;
            }
            return buf;
        }
    }

    static int IndexOfBytes(byte[] hay, byte[] needle, int limit)
    {
        if (needle.Length == 0) return -1;
        int last = Math.Min(hay.Length, limit) - needle.Length;
        for (int i = 0; i <= last; i++)
        {
            bool same = true;
            for (int j = 0; j < needle.Length; j++)
            {
                if (hay[i + j] != needle[j]) { same = false; break; }
            }
            if (same) return i;
        }
        return -1;
    }

    /** Строки в .SHD лежат по произвольному смещению — ищем байтами, не текстом. */
    static bool HasText(byte[] head, string value)
    {
        if (string.IsNullOrEmpty(value)) return false;
        return IndexOfBytes(head, System.Text.Encoding.Unicode.GetBytes(value), head.Length) >= 0;
    }

    /** Номер задания лежит в заголовке .SHD отдельным полем. */
    static bool HasJobId(byte[] head, uint jobId)
    {
        byte[] needle = BitConverter.GetBytes(jobId);
        return IndexOfBytes(head, needle, 512) >= 0;
    }

    /**
     * Имя спул-файла со счётчиком спулера, а не с номером задания: «FP00152.SPL»
     * может принадлежать заданию 166. Поэтому файл ищется по содержимому пары
     * .SHD — там лежат имя принтера и документа — и по совпадению размера.
     */
    public static string Report = "";

    static string FindSpool(string dirs, uint jobId, string printer, string document, long size)
    {
        string best = null;
        int bestScore = 0;
        System.Text.StringBuilder log = new System.Text.StringBuilder();

        foreach (string dir in dirs.Split(';'))
        {
            if (dir.Length == 0) continue;
            string exact = Path.Combine(dir, jobId.ToString("00000") + ".SPL");
            if (File.Exists(exact)) { Report = "точное имя"; return exact; }
            if (!Directory.Exists(dir)) continue;
            string[] files;
            try { files = Directory.GetFiles(dir, "*.SPL"); }
            catch (UnauthorizedAccessException) { continue; }

            foreach (string f in files)
            {
                int score = 0;
                string marks = "";
                try
                {
                    string shd = Path.Combine(
                        Path.GetDirectoryName(f), Path.GetFileNameWithoutExtension(f) + ".SHD");
                    if (File.Exists(shd))
                    {
                        byte[] head = Head(shd, 256 * 1024);
                        if (HasJobId(head, jobId)) { score += 4; marks += "номер "; }
                        if (HasText(head, document)) { score += 3; marks += "документ "; }
                        if (HasText(head, printer)) { score += 2; marks += "принтер "; }
                    }
                    else marks += "без.SHD ";
                    if (size > 0 && new FileInfo(f).Length == size) { score += 2; marks += "размер "; }
                }
                catch (IOException) { continue; }
                catch (UnauthorizedAccessException) { continue; }

                log.Append(" ").Append(Path.GetFileName(f)).Append("=").Append(score);
                if (marks.Length > 0) log.Append("(").Append(marks.Trim()).Append(")");
                if (score > bestScore) { bestScore = score; best = f; }
            }
        }
        Report = "кандидаты:" + (log.Length == 0 ? " нет" : log.ToString());
        // Одного размера мало: нужен номер задания либо имя документа.
        return bestScore >= 3 ? best : null;
    }

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

    public static string Move(string source, uint jobId, string target, string spoolDirs, long size)
    {
        IntPtr src = Open(source);
        bool paused = false;
        try
        {
            uint bufSize;
            IntPtr buf = JobBuffer(src, jobId, out bufSize);
            JOB_INFO_1 info = (JOB_INFO_1)Marshal.PtrToStructure(buf, typeof(JOB_INFO_1));
            string datatype = Marshal.PtrToStringUni(info.pDatatype);
            string document = Marshal.PtrToStringUni(info.pDocument);
            Marshal.FreeHGlobal(buf);

            // Пауза не даёт спулеру дочитать задание, пока мы его копируем.
            paused = SetJob(src, jobId, 0, IntPtr.Zero, JOB_CONTROL_PAUSE);

            string spl = FindSpool(spoolDirs, jobId, source, document, size);
            if (spl == null)
                throw new Exception(
                    "no-spool-file|задание " + jobId + " статус 0x" + info.Status.ToString("X") +
                    " размер " + size + " документ " + document + " тип " + datatype +
                    "|" + Report + Describe(spoolDirs));
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
                    paused = false;
                    return "{\\"ok\\":true,\\"jobId\\":" + newId + ",\\"datatype\\":\\"" + datatype + "\\"}";
                }
                finally { Marshal.FreeHGlobal(add); }
            }
            finally { ClosePrinter(dst); }
        }
        finally
        {
            // Не получилось — задание обязано вернуться в работу, а не зависнуть.
            if (paused) SetJob(src, jobId, 0, IntPtr.Zero, JOB_CONTROL_RESUME);
            ClosePrinter(src);
        }
    }
}
"@

try {
  [PQSpool]::Move('__SRC__', __JOB__, '__DST__', '__DIR__', __SIZE__)
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
  'no-spool-file':
    'Файл задания не сохранён — нажмите «Разрешить перенос», и следующие задания переедут',
  'empty-spool-file': 'Файл задания ещё пуст — повторите через секунду',
  'job-gone:0': 'Задание уже ушло из очереди',
}

export function explain(full?: string) {
  // После «|» идёт диагностика для журнала, пользователю она не нужна.
  const error = full?.split('|')[0]
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
  const res = await psJson<{ ok: boolean; dir: string; x64: boolean; files: number }>(
    `$d = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers' -Name DefaultSpoolDirectory -ErrorAction SilentlyContinue).DefaultSpoolDirectory; ` +
      `if (-not $d) { $d = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS' }; ` +
      `try { $f = @(Get-ChildItem -Force -ErrorAction Stop $d); $ok = $true } catch { $f = @(); $ok = $false }; ` +
      `ConvertTo-Json -Compress ([pscustomobject]@{ ok = $ok; dir = $d; x64 = [Environment]::Is64BitProcess; files = $f.Count })`,
    10000,
  )
  if (res) log(`спул: ${res.dir}, доступ ${res.ok ? 'есть' : 'нет'}, файлов ${res.files}, x64=${res.x64}`)
  return !!res?.ok
}

export async function moveSpoolJob(
  source: string,
  jobId: number,
  target: string,
  size = 0,
): Promise<SpoolMoveResult> {
  const dirs = await spoolDirs(source)
  const script = HELPER.replace('__SRC__', psq(source))
    .replace('__JOB__', String(jobId))
    .replace('__DST__', psq(target))
    .replace('__DIR__', psq(dirs.join(';')))
    .replace('__SIZE__', String(Math.max(0, Math.round(size))))
  const res = (await psJson<SpoolMoveResult>(script, 30000)) ?? {
    ok: false,
    error: 'helper-failed',
  }
  log(`${source} #${jobId} -> ${target}: ${res.ok ? 'ok ' + res.jobId : res.error}`)
  return res
}

/** Короткий журнал переносов рядом с настройками — для разбора на месте. */
export function log(line: string) {
  try {
    appendFileSync(
      join(app.getPath('userData'), 'move.log'),
      `${new Date().toISOString()} ${line}\r\n`,
      'utf8',
    )
  } catch {
    /* журнал не должен мешать работе */
  }
}

let cachedDefault = ''

/** Каталог принтера может быть переопределён — проверяем оба места. */
async function spoolDirs(printer: string) {
  const res = await psJson<{ common: string; own: string | null }>(
    `$root = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers'; ` +
      `$d = (Get-ItemProperty $root -Name DefaultSpoolDirectory -ErrorAction SilentlyContinue).DefaultSpoolDirectory; ` +
      `if (-not $d) { $d = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS' }; ` +
      `$own = (Get-ItemProperty (Join-Path $root '${psq(printer)}') -Name SpoolDirectory -ErrorAction SilentlyContinue).SpoolDirectory; ` +
      `ConvertTo-Json -Compress ([pscustomobject]@{ common = $d; own = $own })`,
    10000,
  )
  const common = res?.common || cachedDefault || 'C:\\Windows\\System32\\spool\\PRINTERS'
  cachedDefault = common
  return [res?.own, common].filter((x): x is string => !!x)
}
