$log = "D:\tooll\kill_zombies.log"
"" | Out-File $log -Force
function Log($m) { $m | Tee-Object -FilePath $log -Append }

# Kill PID 12548 (watcher cu, chay tu 23:56 hom qua)
$id = 12548
Log "=== Killing PID $id ==="

# Method 1: Stop-Process
try { Stop-Process -Id $id -Force -ErrorAction Stop; Log "  [OK] Stop-Process" }
catch { Log "  [FAIL] Stop-Process: $($_.Exception.Message)" }

Start-Sleep -Milliseconds 500

# Method 2: taskkill /F /T (kill ca tree)
$r = (taskkill /F /T /PID $id 2>&1) -join " "
Log "  [taskkill] $r"

Start-Sleep -Milliseconds 500

# Method 3: WMI delete
$r2 = (wmic process where "ProcessId=$id" delete 2>&1) -join " "
Log "  [wmic] $r2"

Start-Sleep -Milliseconds 500

# Method 4: Win32 TerminateProcess
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PK2 {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr h);
}
"@
} catch {}
$h = [PK2]::OpenProcess(0x1F0FFF, $false, [uint32]$id)
if ($h -ne [IntPtr]::Zero) {
  $ok = [PK2]::TerminateProcess($h, 1)
  [PK2]::CloseHandle($h) | Out-Null
  Log "  [Win32] TerminateProcess: $ok"
} else {
  $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Log "  [Win32] OpenProcess FAIL error=$err"
}

Start-Sleep -Seconds 2

$alive = Get-CimInstance Win32_Process -Filter "ProcessId=$id" | Select-Object -First 1
if ($alive) { Log "  PID $id STILL ALIVE!" } else { Log "  PID $id GONE." }
