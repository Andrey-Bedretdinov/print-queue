<#
    Быстрая выкладка без релиза: подменяет app.asar в установленном приложении.
    Перед запуском: npm run build ; npx electron-builder --win --dir --x64 --publish never

    .\tools\pq-deploy.ps1 [-Asar путь] [-NoStart]

    Требует прав администратора (пишет в Program Files).
#>
param(
  [string]$Asar = "$PSScriptRoot\..\release\win-unpacked\resources\app.asar",
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$target = 'C:\Program Files\Print Queue\resources\app.asar'
$exe = 'C:\Program Files\Print Queue\Print Queue.exe'

if (-not (Test-Path $Asar)) { throw "Сборки нет: $Asar. Сначала electron-builder --win --dir --x64" }
if (-not (Test-Path $target)) { throw "Приложение не установлено: $target" }

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Нужен запуск от администратора'
}

Stop-Process -Name 'Print Queue' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$backup = "$target.bak"
if (-not (Test-Path $backup)) {
  Copy-Item $target $backup
  Write-Output "Резервная копия: $backup"
}

Copy-Item $Asar $target -Force
Write-Output "Выложено: $((Get-Item $target).Length) байт"

if (-not $NoStart) {
  Start-Process $exe
  Write-Output 'Приложение запущено'
}
