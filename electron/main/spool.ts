import { app } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { psJson, psJsonFile, psq } from './powershell'

/**
 * Перенос чужого задания между принтерами — без оглядки на драйверы.
 *
 * Данные задания берутся у самого спулера: OpenPrinter принимает имя вида
 * «Принтер, Job 217» и отдаёт хэндл задания, из которого ReadPrinter вычитывает
 * спул целиком в память приложения. Дальше важно, что именно там лежит.
 *
 * Обычное задание Windows (тип «NT EMF 1.00x») — это контейнер EMFSPOOL: на
 * каждую страницу по готовому EMF, аппаратно-независимой векторной записи GDI.
 * Мы разбираем контейнер на страницы и проигрываем их PlayEnhMetaFile в DC
 * целевого принтера — то есть страницу заново рисует драйвер получателя. Это
 * ровно то, что спулер делает сам при печати, поэтому переносить можно между
 * любыми принтерами: Epson → Epson другой модели, Epson → PDF, куда угодно.
 *
 * Побайтовая копия спула так не умеет: EMF несёт DEVMODE источника, а RAW —
 * уже готовый код конкретной модели. Она осталась запасным путём для заданий,
 * которые пришли не в EMF, и только когда драйвер у принтеров общий.
 */

const HELPER = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public class PQMoveResult
{
    public uint JobId;
    public string Datatype;
    public long Bytes;
    public int Pages;
    public string Mode;
}

public static class PQSpool
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PRINTER_DEFAULTS { public string pDatatype; public IntPtr pDevMode; public int DesiredAccess; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DOCINFO
    {
        public int cbSize;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszOutput;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszDatatype;
        public int fwType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, ref PRINTER_DEFAULTS defaults);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ReadPrinter(IntPtr handle, IntPtr buf, uint size, out uint read);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool AddJob(IntPtr handle, uint level, IntPtr data, uint size, out uint needed);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ScheduleJob(IntPtr handle, uint jobId);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetJob(IntPtr handle, uint jobId, uint level, IntPtr data, uint size, out uint needed);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetJob(IntPtr handle, uint jobId, uint level, IntPtr data, uint command);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int DocumentProperties(IntPtr hwnd, IntPtr handle, string device,
        IntPtr outMode, IntPtr inMode, int fMode);

    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateDC(string driver, string device, string port, IntPtr dm);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int StartDoc(IntPtr hdc, ref DOCINFO di);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern int StartPage(IntPtr hdc);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern int EndPage(IntPtr hdc);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern int EndDoc(IntPtr hdc);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern int AbortDoc(IntPtr hdc);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern IntPtr SetEnhMetaFileBits(uint size, byte[] data);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern bool PlayEnhMetaFile(IntPtr hdc, IntPtr hemf, ref RECT r);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern bool DeleteEnhMetaFile(IntPtr hemf);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern int GetDeviceCaps(IntPtr hdc, int index);

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

    const uint JOB_STATUS_PAUSED = 0x1;
    const uint JOB_STATUS_SPOOLING = 0x8;

    // SetJob уровня 1 (тип данных, имя документа) требует ADMINISTER;
    // с одним USE спулер отвечает ACCESS_DENIED и молча оставляет RAW.
    const int PRINTER_ACCESS_ADMINISTER = 0x4;
    const int PRINTER_ACCESS_USE = 0x8;

    const int HORZRES = 8, VERTRES = 10;
    const int DM_OUT_BUFFER = 2, DM_IN_BUFFER = 8;

    const uint EMF_SIGNATURE = 0x464D4520; // " EMF"

    /** Хэндл с правами на правку заданий; без прав — обычный, для паузы хватит. */
    static IntPtr Open(string printer)
    {
        PRINTER_DEFAULTS d = new PRINTER_DEFAULTS();
        d.DesiredAccess = PRINTER_ACCESS_ADMINISTER | PRINTER_ACCESS_USE;
        IntPtr h;
        if (OpenPrinter(printer, out h, ref d)) return h;
        if (OpenPrinter(printer, out h, IntPtr.Zero)) return h;
        throw new Exception("open-printer:" + Marshal.GetLastWin32Error());
    }

    static IntPtr JobBuffer(IntPtr handle, uint jobId, out uint size)
    {
        uint needed;
        GetJob(handle, jobId, 1, IntPtr.Zero, 0, out needed);
        if (needed == 0) throw new Exception("job-gone:" + Marshal.GetLastWin32Error());
        IntPtr buf = Marshal.AllocHGlobal((int)needed);
        if (!GetJob(handle, jobId, 1, buf, needed, out needed))
        {
            Marshal.FreeHGlobal(buf);
            throw new Exception("get-job:" + Marshal.GetLastWin32Error());
        }
        size = needed;
        return buf;
    }

    static JOB_INFO_1 JobInfo(IntPtr handle, uint jobId)
    {
        uint size;
        IntPtr buf = JobBuffer(handle, jobId, out size);
        try { return (JOB_INFO_1)Marshal.PtrToStructure(buf, typeof(JOB_INFO_1)); }
        finally { Marshal.FreeHGlobal(buf); }
    }

    /**
     * Пока программа-источник дописывает задание, читать нечего: ReadPrinter
     * отдаст обрезок. Большая печать из Lightroom спулится десяток секунд —
     * ждём, а не отказываем сразу.
     */
    static JOB_INFO_1 WaitSpooled(IntPtr handle, uint jobId)
    {
        JOB_INFO_1 info = JobInfo(handle, jobId);
        for (int i = 0; i < 60 && (info.Status & JOB_STATUS_SPOOLING) != 0; i++)
        {
            System.Threading.Thread.Sleep(250);
            info = JobInfo(handle, jobId);
        }
        return info;
    }

    /** Спул-данные задания — прямо у спулера, минуя каталог со спул-файлами. */
    static byte[] ReadJob(string printer, uint jobId)
    {
        IntPtr h;
        // Именно нулевые PRINTER_DEFAULTS: с PRINTER_ACCESS_USE спулер
        // отвечает на хэндл задания ACCESS_DENIED.
        if (!OpenPrinter(printer + ", Job " + jobId, out h, IntPtr.Zero))
            throw new Exception("open-job:" + Marshal.GetLastWin32Error());
        try
        {
            const int CHUNK = 1024 * 1024;
            MemoryStream ms = new MemoryStream();
            IntPtr buf = Marshal.AllocHGlobal(CHUNK);
            try
            {
                byte[] chunk = new byte[CHUNK];
                uint got;
                while (ReadPrinter(h, buf, CHUNK, out got) && got > 0)
                {
                    Marshal.Copy(buf, chunk, 0, (int)got);
                    ms.Write(chunk, 0, (int)got);
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            return ms.ToArray();
        }
        finally { ClosePrinter(h); }
    }

    /** Похоже ли на начало самостоятельного EMF: тип записи 1 и подпись " EMF". */
    static bool IsEmfAt(byte[] d, int pos)
    {
        if (pos < 0 || pos + 52 > d.Length) return false;
        return BitConverter.ToUInt32(d, pos) == 1 &&
               BitConverter.ToUInt32(d, pos + 40) == EMF_SIGNATURE;
    }

    /**
     * Разбор контейнера EMFSPOOL. Записи идут парами (ulID, cjSize); нас
     * интересуют те, в теле которых лежит EMF — по одному на страницу.
     * У «расширенных» разновидностей записи телу предшествует смещение,
     * поэтому подпись проверяется по обоим вариантам.
     */
    public static List<byte[]> Pages(byte[] d)
    {
        List<byte[]> pages = new List<byte[]>();
        if (d.Length < 12) return pages;

        int pos = (int)BitConverter.ToUInt32(d, 4);
        if (pos < 8 || pos >= d.Length) pos = 36;

        while (pos + 8 <= d.Length)
        {
            uint id = BitConverter.ToUInt32(d, pos);
            uint size = BitConverter.ToUInt32(d, pos + 4);
            if (id == 0 || size == 0) break;

            int body = pos + 8;
            if (!IsEmfAt(d, body) && IsEmfAt(d, body + 8)) body += 8;
            if (IsEmfAt(d, body))
            {
                int len = (int)BitConverter.ToUInt32(d, body + 48); // nBytes из EMR_HEADER
                if (len <= 0 || body + len > d.Length) len = (int)size - (body - pos - 8);
                if (len > 0 && body + len <= d.Length)
                {
                    byte[] emf = new byte[len];
                    Buffer.BlockCopy(d, body, emf, 0, len);
                    pages.Add(emf);
                }
            }

            long next = (long)pos + 8 + size;
            next = (next + 3) & ~3L;
            if (next <= pos || next > d.Length) break;
            pos = (int)next;
        }
        return pages;
    }

    /** DEVMODE источника из контейнера — нужен, чтобы забрать ориентацию и формат. */
    static byte[] SourceDevmode(byte[] d)
    {
        if (d.Length < 12) return null;
        int pos = (int)BitConverter.ToUInt32(d, 4);
        if (pos < 8 || pos >= d.Length) pos = 36;
        while (pos + 8 <= d.Length)
        {
            uint id = BitConverter.ToUInt32(d, pos);
            uint size = BitConverter.ToUInt32(d, pos + 4);
            if (id == 0 || size == 0) break;
            if (id == 0x03 && pos + 8 + size <= d.Length && size >= 92)
            {
                byte[] dm = new byte[size];
                Buffer.BlockCopy(d, pos + 8, dm, 0, (int)size);
                return dm;
            }
            long next = ((long)pos + 8 + size + 3) & ~3L;
            if (next <= pos || next > d.Length) break;
            pos = (int)next;
        }
        return null;
    }

    // Смещения полей DEVMODEW, которые имеет смысл перенести на другой принтер.
    const int DM_SIZE = 68, DM_FIELDS = 72, DM_ORIENTATION = 76, DM_PAPERSIZE = 78;
    const int DM_PAPERLENGTH = 80, DM_PAPERWIDTH = 82, DM_COPIES = 86;
    const int DM_COLOR = 92, DM_DUPLEX = 94;

    static void CopyField(byte[] src, IntPtr dst, int offset, uint bit)
    {
        uint fields = BitConverter.ToUInt32(src, DM_FIELDS);
        if ((fields & bit) == 0) return;
        short v = BitConverter.ToInt16(src, offset);
        Marshal.WriteInt16(dst, offset, v);
        int dstSize = Marshal.ReadInt16(dst, DM_SIZE);
        if (offset + 2 > dstSize) return;
        Marshal.WriteInt32(dst, DM_FIELDS, (int)(((uint)Marshal.ReadInt32(dst, DM_FIELDS)) | bit));
    }

    /**
     * DEVMODE получателя: берём его собственный (со всеми родными полями),
     * а от источника переносим только устройство-независимое — ориентацию,
     * формат бумаги, число копий, цвет и дуплекс. Драйвер потом сам проверит
     * набор через DocumentProperties и выкинет то, чего не умеет.
     */
    static IntPtr TargetDevmode(IntPtr handle, string target, byte[] srcDm)
    {
        int needed = DocumentProperties(IntPtr.Zero, handle, target, IntPtr.Zero, IntPtr.Zero, 0);
        if (needed <= 0) return IntPtr.Zero;
        IntPtr dm = Marshal.AllocHGlobal(needed);
        try
        {
            if (DocumentProperties(IntPtr.Zero, handle, target, dm, IntPtr.Zero, DM_OUT_BUFFER) < 0)
            {
                Marshal.FreeHGlobal(dm);
                return IntPtr.Zero;
            }
            if (srcDm != null && srcDm.Length >= 96)
            {
                CopyField(srcDm, dm, DM_ORIENTATION, 0x1);
                CopyField(srcDm, dm, DM_PAPERSIZE, 0x2);
                CopyField(srcDm, dm, DM_PAPERLENGTH, 0x4);
                CopyField(srcDm, dm, DM_PAPERWIDTH, 0x8);
                CopyField(srcDm, dm, DM_COPIES, 0x100);
                CopyField(srcDm, dm, DM_COLOR, 0x800);
                CopyField(srcDm, dm, DM_DUPLEX, 0x1000);
                DocumentProperties(IntPtr.Zero, handle, target, dm, dm, DM_IN_BUFFER | DM_OUT_BUFFER);
            }
            return dm;
        }
        catch { Marshal.FreeHGlobal(dm); return IntPtr.Zero; }
    }

    /**
     * Перерисовка страниц драйвером получателя. Метафайл ложится на область
     * печати целевого принтера, так что задание подстраивается под его бумагу,
     * а не тащит за собой геометрию источника.
     */
    static uint Replay(IntPtr dstHandle, string target, string document, List<byte[]> pages, byte[] srcDm)
    {
        IntPtr dm = TargetDevmode(dstHandle, target, srcDm);
        try
        {
            IntPtr hdc = CreateDC(null, target, null, dm);
            if (hdc == IntPtr.Zero && dm != IntPtr.Zero) hdc = CreateDC(null, target, null, IntPtr.Zero);
            if (hdc == IntPtr.Zero) throw new Exception("create-dc:" + Marshal.GetLastWin32Error());
            try
            {
                RECT rc = new RECT();
                rc.right = GetDeviceCaps(hdc, HORZRES);
                rc.bottom = GetDeviceCaps(hdc, VERTRES);
                if (rc.right <= 0 || rc.bottom <= 0) throw new Exception("no-print-area");

                DOCINFO di = new DOCINFO();
                di.cbSize = Marshal.SizeOf(typeof(DOCINFO));
                di.lpszDocName = document;
                int job = StartDoc(hdc, ref di);
                if (job <= 0) throw new Exception("start-doc:" + Marshal.GetLastWin32Error());

                bool ok = false;
                try
                {
                    foreach (byte[] emf in pages)
                    {
                        IntPtr h = SetEnhMetaFileBits((uint)emf.Length, emf);
                        if (h == IntPtr.Zero) throw new Exception("bad-page:" + Marshal.GetLastWin32Error());
                        try
                        {
                            if (StartPage(hdc) <= 0) throw new Exception("start-page:" + Marshal.GetLastWin32Error());
                            PlayEnhMetaFile(hdc, h, ref rc);
                            if (EndPage(hdc) <= 0) throw new Exception("end-page:" + Marshal.GetLastWin32Error());
                        }
                        finally { DeleteEnhMetaFile(h); }
                    }
                    if (EndDoc(hdc) <= 0) throw new Exception("end-doc:" + Marshal.GetLastWin32Error());
                    ok = true;
                }
                finally { if (!ok) AbortDoc(hdc); }
                return (uint)job;
            }
            finally { DeleteDC(hdc); }
        }
        finally { if (dm != IntPtr.Zero) Marshal.FreeHGlobal(dm); }
    }

    /**
     * Запасной путь для не-EMF заданий: спул кладётся на целевой принтер как
     * есть. Годится, только когда драйвер общий — RAW уже собран под модель.
     */
    static uint RawCopy(IntPtr dst, byte[] data, string datatype, string document)
    {
        uint needed;
        AddJob(dst, 1, IntPtr.Zero, 0, out needed);
        if (needed == 0) throw new Exception("add-job:" + Marshal.GetLastWin32Error());
        IntPtr add = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!AddJob(dst, 1, add, needed, out needed))
                throw new Exception("add-job:" + Marshal.GetLastWin32Error());
            string outPath = Marshal.PtrToStringUni(Marshal.ReadIntPtr(add));
            uint newId = (uint)Marshal.ReadInt32(add, IntPtr.Size);
            File.WriteAllBytes(outPath, data);

            uint size2;
            IntPtr buf2 = JobBuffer(dst, newId, out size2);
            bool typed;
            try
            {
                JOB_INFO_1 fresh = (JOB_INFO_1)Marshal.PtrToStructure(buf2, typeof(JOB_INFO_1));
                fresh.pDatatype = Marshal.StringToHGlobalUni(datatype);
                fresh.pDocument = Marshal.StringToHGlobalUni(document);
                fresh.pStatus = IntPtr.Zero;
                Marshal.StructureToPtr(fresh, buf2, false);
                typed = SetJob(dst, newId, 1, buf2, 0);
            }
            finally { Marshal.FreeHGlobal(buf2); }

            // AddJob заводит задание как RAW. Расписать чужой тип под видом RAW —
            // это пачка мусора на бумаге, так что лучше отменить перенос.
            if (!typed)
            {
                int err = Marshal.GetLastWin32Error();
                SetJob(dst, newId, 0, IntPtr.Zero, JOB_CONTROL_DELETE);
                throw new Exception("set-datatype:" + err);
            }
            if (!ScheduleJob(dst, newId))
            {
                int err = Marshal.GetLastWin32Error();
                SetJob(dst, newId, 0, IntPtr.Zero, JOB_CONTROL_DELETE);
                throw new Exception("schedule:" + err);
            }
            return newId;
        }
        finally { Marshal.FreeHGlobal(add); }
    }

    public static PQMoveResult Move(string source, uint jobId, string target, bool sameDriver)
    {
        IntPtr src = Open(source);
        bool paused = false;
        try
        {
            JOB_INFO_1 info = WaitSpooled(src, jobId);
            string datatype = Marshal.PtrToStringUni(info.pDatatype);
            string document = Marshal.PtrToStringUni(info.pDocument);
            if (string.IsNullOrEmpty(document)) document = "Задание " + jobId;

            if ((info.Status & JOB_STATUS_SPOOLING) != 0)
                throw new Exception("still-spooling|задание " + jobId + " всё ещё пишется");

            // Пауза не даёт спулеру начать печать, пока мы копируем задание.
            // Уже стоявшее на паузе задание разжимать обратно нельзя — иначе
            // сорвавшийся перенос отправит его печататься на старый принтер.
            if ((info.Status & JOB_STATUS_PAUSED) == 0)
                paused = SetJob(src, jobId, 0, IntPtr.Zero, JOB_CONTROL_PAUSE);

            byte[] data = ReadJob(source, jobId);
            if (data.Length == 0)
                throw new Exception(
                    "no-spool-data|задание " + jobId + " статус 0x" + info.Status.ToString("X") +
                    " документ " + document + " тип " + datatype);

            List<byte[]> pages = Pages(data);

            PQMoveResult res = new PQMoveResult();
            res.Datatype = datatype;
            res.Bytes = data.Length;
            res.Pages = pages.Count;

            IntPtr dst = Open(target);
            try
            {
                if (pages.Count > 0)
                {
                    res.JobId = Replay(dst, target, document, pages, SourceDevmode(data));
                    res.Mode = "emf";
                }
                else if (sameDriver)
                {
                    res.JobId = RawCopy(dst, data, datatype, document);
                    res.Mode = "raw";
                }
                else
                {
                    throw new Exception(
                        "cross-driver-raw|тип " + datatype + ", страниц EMF нет, драйверы разные");
                }
            }
            finally { ClosePrinter(dst); }

            SetJob(src, jobId, 0, IntPtr.Zero, JOB_CONTROL_DELETE);
            paused = false;
            return res;
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
  $sd = (Get-Printer -Name '__SRC__' -ErrorAction SilentlyContinue).DriverName
  $td = (Get-Printer -Name '__DST__' -ErrorAction SilentlyContinue).DriverName
  $r = [PQSpool]::Move('__SRC__', __JOB__, '__DST__', [bool]($sd -and $td -and $sd -eq $td))
  ConvertTo-Json -Compress ([pscustomobject]@{
    ok = $true; jobId = [int]$r.JobId; datatype = $r.Datatype
    bytes = $r.Bytes; pages = $r.Pages; mode = $r.Mode
  })
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
  bytes?: number
  pages?: number
  mode?: 'emf' | 'raw'
  error?: string
}

const REASON: Record<string, string> = {
  'no-spool-data':
    'Файл задания не сохранён — нажмите «Разрешить перенос», и следующие задания переедут',
  'still-spooling': 'Задание ещё записывается — повторите, когда оно допишется',
  'cross-driver-raw':
    'Задание пришло не в формате Windows — его можно перенести только на принтер с тем же драйвером',
  'no-print-area': 'У целевого принтера не задана область печати',
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
  if (error.startsWith('open-job:')) return 'Спулер не отдал данные задания'
  if (error.startsWith('create-dc:')) return 'Целевой принтер не открывается на печать'
  if (error.startsWith('bad-page:')) return 'Страница задания повреждена'
  if (error.startsWith('start-doc:') || error.startsWith('start-page:')) {
    return 'Целевой принтер не принял задание'
  }
  if (error.startsWith('end-page:') || error.startsWith('end-doc:')) {
    return 'Печать на целевом принтере оборвалась'
  }
  if (error.startsWith('add-job:')) return 'Целевой принтер не принял задание'
  if (error.startsWith('set-datatype:')) return 'Нужны права администратора'
  if (error.startsWith('schedule:')) return 'Не удалось поставить задание в очередь'
  return error
}

/** true, если правка чужих заданий доступна — то есть процесс поднят как администратор. */
export async function canMoveSystemJobs() {
  const res = await psJson<{ ok: boolean; x64: boolean }>(
    `$id = [Security.Principal.WindowsIdentity]::GetCurrent(); ` +
      `$ok = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(` +
      `[Security.Principal.WindowsBuiltInRole]::Administrator); ` +
      `ConvertTo-Json -Compress ([pscustomobject]@{ ok = $ok; x64 = [Environment]::Is64BitProcess })`,
    10000,
  )
  if (res) log(`права: администратор ${res.ok ? 'есть' : 'нет'}, x64=${res.x64}`)
  return !!res?.ok
}

export async function moveSpoolJob(
  source: string,
  jobId: number,
  target: string,
): Promise<SpoolMoveResult> {
  const script = HELPER.replace(/__SRC__/g, psq(source))
    .replace('__JOB__', String(jobId))
    .replace(/__DST__/g, psq(target))
  // Крупный фотоснимок спулится и перерисовывается небыстро — минуты хватает.
  const res = (await psJsonFile<SpoolMoveResult>(script, 180000)) ?? {
    ok: false,
    error: 'helper-failed',
  }
  log(
    `${source} #${jobId} -> ${target}: ` +
      (res.ok
        ? `ok ${res.jobId}, ${res.mode}, страниц ${res.pages}, ${res.bytes} байт, ${res.datatype}`
        : res.error),
  )
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
