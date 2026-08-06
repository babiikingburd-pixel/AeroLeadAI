# AeroLeadAI APEX 9.6 - stop the running production server.
param([int]$Port = 5000)
$ErrorActionPreference = "Stop"
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { Write-Host "Nothing is listening on port $Port."; exit 0 }
foreach ($pid in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "Stopping $($proc.ProcessName) (PID $pid) on port $Port"
    Stop-Process -Id $pid -Force
  }
}
Write-Host "AeroLeadAI stopped."
