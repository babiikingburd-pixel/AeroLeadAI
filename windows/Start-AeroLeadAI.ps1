# AeroLeadAI APEX 9.6 - start the production server on Windows.
param([int]$Port = 5000, [switch]$OpenBrowser)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path "$root\node_modules")) { Write-Host "== Installing dependencies"; npm install --no-audit --no-fund }
if (-not (Test-Path "$root\.next")) {
  Write-Host "== No build found; building first"
  npm run build; if ($LASTEXITCODE -ne 0) { Write-Error "next build failed."; exit 1 }
}
if (-not (Test-Path "$root\.env.local")) {
  Write-Warning "No .env.local found. Supabase and API keys must be set in the environment or routes will degrade."
}
$env:PORT = "$Port"
if ($OpenBrowser) { Start-Process "http://localhost:$Port" }
Write-Host "== Starting AeroLeadAI on http://localhost:$Port  (Ctrl+C to stop)"
npx next start -p $Port
