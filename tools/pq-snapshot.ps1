<#
    Снимок состояния: принтеры, очереди, задания, спул-каталог, настройки.
    Запускать на самой машине. Пишет отчёт рядом с собой.

    .\tools\pq-snapshot.ps1 [-Out путь]
#>
param([string]$Out = "$PSScriptRoot\..\pq-snapshot.txt")

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function W($m) { Add-Content -Path $Out -Value $m -Encoding UTF8 }
Set-Content -Path $Out -Value "=== СНИМОК $(Get-Date -Format s) ===" -Encoding UTF8

W ''; W '--- ПРИНТЕРЫ ---'
Get-Printer | ForEach-Object {
  W ("{0} | драйвер={1} | порт={2} | статус={3}" -f $_.Name, $_.DriverName, $_.PortName, $_.PrinterStatus)
}

W ''; W '--- СОСТОЯНИЕ ОЧЕРЕДЕЙ ---'
W 'PrinterState: 0 готов, 1 пауза, 2 ошибка'
Get-WmiObject Win32_Printer | ForEach-Object {
  W ("{0} | PrinterState={1} | PrinterStatus={2}" -f $_.Name, $_.PrinterState, $_.PrinterStatus)
}

W ''; W '--- ЗАДАНИЯ ---'
$jobs = Get-WmiObject Win32_PrintJob
if (-not $jobs) { W '(очереди пусты)' }
$jobs | ForEach-Object {
  W ("{0} | документ='{1}' | тип={2} | размер={3} | страниц={4} | статус='{5}' | владелец={6}" -f `
     $_.Name, $_.Document, $_.DataType, $_.Size, $_.TotalPages, $_.JobStatus, $_.Owner)
}

W ''; W '--- ПРИЛОЖЕНИЕ ---'
$p = @(Get-Process | Where-Object { $_.Path -like '*Print Queue*' })
W ("процессов запущено: " + $p.Count)
$asar = 'C:\Program Files\Print Queue\resources\app.asar'
if (Test-Path $asar) {
  $i = Get-Item $asar
  W ("app.asar: $($i.Length) байт, изменён $($i.LastWriteTime)")
}

W ''; W '--- НАСТРОЙКИ И ЖУРНАЛ ---'
$dir = Join-Path $env:APPDATA 'print-queue'
Get-ChildItem $dir -File -ErrorAction SilentlyContinue | ForEach-Object { W ("  $($_.Name) $($_.Length) байт") }
$log = Join-Path $dir 'move.log'
if (Test-Path $log) {
  W '--- журнал переносов, последние 40 ---'
  Get-Content $log -Tail 40 -Encoding UTF8 | ForEach-Object { W $_ }
}

W ''; W '--- СПУЛ-КАТАЛОГ ---'
Get-ChildItem 'C:\Windows\System32\spool\PRINTERS' -Force -ErrorAction SilentlyContinue |
  ForEach-Object { W ("  $($_.Name) $($_.Length)") }

W ''; W '--- ОС ---'
W ((Get-CimInstance Win32_OperatingSystem).Caption + ' build ' + [Environment]::OSVersion.Version)

Write-Output "Снимок записан: $Out"
