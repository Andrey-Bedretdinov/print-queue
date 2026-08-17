<#
    Разбор спула задания: структура контейнера EMFSPOOL и страницы внутри.
    Нужен при работе над переносом и над предпросмотром чужих заданий.

    .\tools\pq-spool-probe.ps1 [-Printer маска] [-Dump путь]

    Без параметров берёт первое задание в первой непустой очереди.
    -Dump сохраняет спул в файл для дальнейшего разбора.
    Требует прав администратора.
#>
param([string]$Printer = '*', [string]$Dump = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class PQProbe
{
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ReadPrinter(IntPtr h, IntPtr buf, uint size, out uint read);

    /** Хэндл задания открывается только с нулевыми PRINTER_DEFAULTS. */
    public static byte[] ReadJob(string printer, uint jobId)
    {
        IntPtr h;
        if (!OpenPrinter(printer + ", Job " + jobId, out h, IntPtr.Zero))
            throw new Exception("open-job:" + Marshal.GetLastWin32Error());
        try
        {
            const int C = 1024 * 1024;
            MemoryStream ms = new MemoryStream();
            IntPtr buf = Marshal.AllocHGlobal(C);
            try
            {
                byte[] chunk = new byte[C];
                uint got;
                while (ReadPrinter(h, buf, C, out got) && got > 0)
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

    static bool IsEmfAt(byte[] d, int pos)
    {
        if (pos < 0 || pos + 52 > d.Length) return false;
        return BitConverter.ToUInt32(d, pos) == 1 && BitConverter.ToUInt32(d, pos + 40) == 0x464D4520;
    }

    public static string Walk(byte[] d)
    {
        System.Text.StringBuilder sb = new System.Text.StringBuilder();
        sb.Append("всего байт: ").Append(d.Length).Append("\n");
        if (d.Length < 12) return sb.Append("слишком мало").ToString();
        sb.Append("заголовок: версия 0x").Append(BitConverter.ToUInt32(d, 0).ToString("X8"))
          .Append(", размер ").Append(BitConverter.ToUInt32(d, 4)).Append("\n");

        int pos = (int)BitConverter.ToUInt32(d, 4);
        if (pos < 8 || pos >= d.Length) pos = 36;
        int pages = 0;
        while (pos + 8 <= d.Length)
        {
            uint id = BitConverter.ToUInt32(d, pos);
            uint size = BitConverter.ToUInt32(d, pos + 4);
            if (id == 0 || size == 0) break;
            int body = pos + 8;
            if (!IsEmfAt(d, body) && IsEmfAt(d, body + 8)) body += 8;
            string extra = "";
            if (IsEmfAt(d, body))
            {
                pages++;
                extra = " [EMF, nBytes=" + BitConverter.ToUInt32(d, body + 48) + "]";
            }
            else if (id == 0x03) extra = " [DEVMODE]";
            sb.Append("  запись id=0x").Append(id.ToString("X2")).Append(" размер=").Append(size)
              .Append(extra).Append("\n");
            long next = ((long)pos + 8 + size + 3) & ~3L;
            if (next <= pos || next > d.Length) break;
            pos = (int)next;
        }
        sb.Append("страниц EMF: ").Append(pages);
        return sb.ToString();
    }
}
"@

$job = $null
foreach ($p in (Get-Printer | Where-Object { $_.Name -like $Printer })) {
  $j = Get-PrintJob -PrinterName $p.Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($j) { $job = $j; $name = $p.Name; break }
}
if (-not $job) { Write-Output 'Заданий в очередях нет'; exit }

Write-Output "принтер: $name"
Write-Output "задание: $($job.Id) '$($job.DocumentName)' размер $($job.Size) статус $($job.JobStatus)"
$data = [PQProbe]::ReadJob($name, [uint32]$job.Id)
Write-Output ([PQProbe]::Walk($data))
if ($Dump) { [IO.File]::WriteAllBytes($Dump, $data); Write-Output "спул сохранён: $Dump" }
