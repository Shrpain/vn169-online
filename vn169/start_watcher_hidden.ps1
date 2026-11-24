$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$supervisor = Join-Path $root "watcher_supervisor.ps1"

if (-not (Test-Path -LiteralPath $supervisor)) {
  throw "Khong tim thay file $supervisor"
}

$argList = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden",
  "-File", "`"$supervisor`"",
  "-KeepAwake"
)

Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WindowStyle Hidden -WorkingDirectory $root
