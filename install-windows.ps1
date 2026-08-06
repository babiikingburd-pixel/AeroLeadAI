# AeroLeadAI APEX 9.6 - Windows installer: verify toolchain, install, build, optionally start.
param([switch]$Start)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is not installed. Install Node 20 LTS from https://nodejs.org and re-run."; exit 1
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Write-Error "Node 20+ required; found $(node -v)."; exit 1 }
Write-Host "OK   Node $(node -v) / npm $(npm -v)"
Write-Host "== Installing dependencies (locked)"
if (Test-Path "$root\package-lock.json") { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE -ne 0) { Write-Error "Dependency install failed."; exit 1 }
& "$PSScriptRoot\build-windows.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Install complete."
if ($Start) { & "$PSScriptRoot\Start-AeroLeadAI.ps1" -OpenBrowser }
