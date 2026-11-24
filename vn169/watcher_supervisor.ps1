param(
  [int]$RestartDelaySeconds = 5,
  [switch]$KeepAwake
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root "logs"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$logFile = Join-Path $logDir "watcher-supervisor.log"
$nodeScript = Join-Path $root "watch_group_messages.js"
$lockFile = Join-Path $root "watcher.lock"

if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "Khong tim thay file $nodeScript"
}

if ($KeepAwake) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PowerUtil {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

  $ES_CONTINUOUS = 0x80000000
  $ES_SYSTEM_REQUIRED = 0x00000001
  $ES_DISPLAY_REQUIRED = 0x00000002
  [PowerUtil]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED) | Out-Null
}

function Test-LockAlive {
  if (-not (Test-Path -LiteralPath $lockFile)) { return $false }
  try {
    $lock = Get-Content -Raw $lockFile | ConvertFrom-Json
    if (-not $lock.pid) { return $false }
    $null = Get-Process -Id $lock.pid -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Cleanup {
  if (Test-Path -LiteralPath $lockFile) { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath (Join-Path $root "bot_poll.lock")) { Remove-Item -LiteralPath (Join-Path $root "bot_poll.lock") -Force -ErrorAction SilentlyContinue }
}

if (Test-LockAlive) {
  $msg = "[$(Get-Date -Format s)] watcher.lock PID alive, another instance running. Supervisor exiting."
  $msg | Add-Content -Path $logFile
  Write-Host $msg
  exit 0
}

"[$(Get-Date -Format s)] Supervisor started" | Add-Content -Path $logFile

while ($true) {
  if (Test-LockAlive) {
    $msg = "[$(Get-Date -Format s)] watcher.lock PID alive after restart wait, another instance took over. Supervisor exiting."
    $msg | Add-Content -Path $logFile
    Write-Host $msg
    exit 0
  }

  Cleanup
  "[$(Get-Date -Format s)] Starting node watcher" | Add-Content -Path $logFile
  $start = Get-Date
  & node $nodeScript 2>&1 | Tee-Object -FilePath $logFile -Append
  $exitCode = $LASTEXITCODE
  $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
  "[$(Get-Date -Format s)] Node exited (code $exitCode) after ${elapsed}s" | Add-Content -Path $logFile

  # If process ran < 10s and exited 0, it's likely a lock conflict or intentional quit -- stop restarting
  if ($exitCode -eq 0 -and $elapsed -lt 10) {
    $msg = "[$(Get-Date -Format s)] Node exited quickly (${elapsed}s) with code 0. Supervisor stopping to avoid restart loop."
    $msg | Add-Content -Path $logFile
    Write-Host $msg
    break
  }

  "[$(Get-Date -Format s)] Restarting in $RestartDelaySeconds s" | Add-Content -Path $logFile
  Start-Sleep -Seconds $RestartDelaySeconds
}
