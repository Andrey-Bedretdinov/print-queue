<#
    Проверка перетаскивания окна: реально двигает мышь и сверяет координаты.
    Запускать в интерактивном сеансе (не по SSH — инжект ввода не пройдёт в чужую сессию).

    .\tools\pq-drag-test.ps1

    Ожидаемый результат: delta примерно 83,65 при запросе 90,70
    (разница — порог начала перетаскивания в Windows). delta 0,0 = перетаскивание сломано.
#>
$ErrorActionPreference = 'Continue'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PQDrag
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint fl);

    const uint MOVE = 0x0001, LDOWN = 0x0002, LUP = 0x0004;

    public static string Drag(IntPtr h, int dx, int dy)
    {
        RECT a; GetWindowRect(h, out a);
        SetForegroundWindow(h);
        System.Threading.Thread.Sleep(400);

        // точка в пустой части титульбара: правее логотипа, левее поиска
        int x = a.L + (int)((a.R - a.L) * 0.35);
        int y = a.T + 18;

        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(150);
        mouse_event(LDOWN, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(150);
        for (int i = 1; i <= 12; i++)
        {
            SetCursorPos(x + dx * i / 12, y + dy * i / 12);
            mouse_event(MOVE, 0, 0, 0, IntPtr.Zero);
            System.Threading.Thread.Sleep(30);
        }
        System.Threading.Thread.Sleep(200);
        mouse_event(LUP, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(500);

        RECT b; GetWindowRect(h, out b);
        string res = "захват " + x + "," + y + " | было " + a.L + "," + a.T +
                     " | стало " + b.L + "," + b.T + " | delta " + (b.L - a.L) + "," + (b.T - a.T);
        SetWindowPos(h, IntPtr.Zero, a.L, a.T, 0, 0, 0x0001 | 0x0004);
        return res;
    }
}
"@

function Ready {
  Get-Process | Where-Object {
    $_.Path -like '*Print Queue*' -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle
  } | Select-Object -First 1
}

$p = Ready
if (-not $p) { Start-Process 'C:\Program Files\Print Queue\Print Queue.exe' }
for ($i = 0; $i -lt 40 -and -not $p; $i++) { Start-Sleep -Seconds 1; $p = Ready }
if (-not $p) { Write-Output 'Окно не появилось'; exit }
Start-Sleep -Seconds 3

Write-Output "окно: pid=$($p.Id) '$($p.MainWindowTitle)'"
Write-Output ([PQDrag]::Drag($p.MainWindowHandle, 90, 70))
