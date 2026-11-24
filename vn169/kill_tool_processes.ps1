# Self-elevate to Administrator if not already elevated
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Yeu cau quyen Admin de kill sach process... Dang mo bang Admin..."
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process powershell -Verb RunAs -ArgumentList $args -Wait
  exit $LASTEXITCODE
}

# --- Bat dau logic kill process duoi quyen Admin ---
$myPids = @()

# Pass 1: Get-CimInstance theo CommandLine
$processes = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='powershell.exe'"
foreach ($p in $processes) {
  $cmd = $p.CommandLine
  $keep = $null -ne $cmd -and (
    $cmd -like '*watch_group_messages*' -or
    $cmd -like '*watcher_supervisor*' -or
    $cmd -like '*start_watcher_hidden*'
  )
  if ($keep) { $myPids += $p.ProcessId }
}

# Pass 2: wmic fallback cho node.exe ma WMI tra ve CommandLine rong
$wmicRaw = cmd /c "wmic process where ""name='node.exe'"" get processid,commandline /format:csv" 2> $null
if ($wmicRaw) {
  $wmicCsv = $wmicRaw | ConvertFrom-Csv -ErrorAction SilentlyContinue
  foreach ($row in $wmicCsv) {
    $pidVal = $row.ProcessId -as [int]
    $cmd    = $row.CommandLine
    if ($pidVal -and $pidVal -gt 0 -and $pidVal -notin $myPids -and $cmd -like '*watch_group_messages*') {
      $myPids += $pidVal
    }
  }
}

# Pass 3: wmic fallback cho powershell.exe
$wmicRaw2 = cmd /c "wmic process where ""name='powershell.exe'"" get processid,commandline /format:csv" 2> $null
if ($wmicRaw2) {
  $wmicCsv2 = $wmicRaw2 | ConvertFrom-Csv -ErrorAction SilentlyContinue
  foreach ($row in $wmicCsv2) {
    $pidVal = $row.ProcessId -as [int]
    $cmd    = $row.CommandLine
    if ($pidVal -and $pidVal -gt 0 -and $pidVal -notin $myPids -and ($cmd -like '*watch_group_messages*' -or $cmd -like '*watcher_supervisor*' -or $cmd -like '*start_watcher_hidden*')) {
      $myPids += $pidVal
    }
  }
}

# Pass 4: Kill cac node.exe bat thuong (co the co hoac khong co CommandLine vi quyen admin da thay het,
# nhung xem PID nao ko trong myPids ma tro den file tool)
$allNode = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
foreach ($n in $allNode) {
  $cmd = $n.CommandLine
  if ($n.ProcessId -notin $myPids -and $cmd -like '*watch_group_messages*') {
    $myPids += $n.ProcessId
  }
}

# Kill unique PIDs
$unique = $myPids | Select-Object -Unique
foreach ($id in $unique) {
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  $r = (taskkill /F /PID $id 2>&1) -join " "
  Write-Host "Killed PID $id ($r)"
}

Write-Host "Killed $($unique.Count) process(es)."
