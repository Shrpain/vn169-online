$ErrorActionPreference = "Stop"
$taskName = "ToolWatcherBackground"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root "start_watcher_hidden.ps1"

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Khong tim thay file $launcher"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Da cai tu dong chay khi dang nhap Windows: $taskName"
Write-Host "Chay thu ngay bay gio bang lenh: Start-ScheduledTask -TaskName $taskName"
