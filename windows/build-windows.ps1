# AeroLeadAI APEX 9.6 - Windows build script.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "== Node check"
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Write-Error "Node 20+ required; found $(node -v)."; exit 1 }
Write-Host "OK   Node $(node -v) / npm $(npm -v)"
if (-not (Test-Path "$root\node_modules")) {
  Write-Host "== Installing dependencies"
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed."; exit 1 }
}
Write-Host "== Build gates"
npm run doctor;      if ($LASTEXITCODE -ne 0) { Write-Error "doctor failed.";      exit 1 }
npm run verify;      if ($LASTEXITCODE -ne 0) { Write-Error "verify failed.";      exit 1 }
npm run apex:status; if ($LASTEXITCODE -ne 0) { Write-Error "apex:status failed."; exit 1 }
Write-Host "== Production build"
npm run build;       if ($LASTEXITCODE -ne 0) { Write-Error "next build failed.";  exit 1 }
$artifacts = Join-Path $root "windows\artifacts"
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$bundle = Join-Path $artifacts "AeroLeadAI-APEX9.6-$stamp.zip"
Write-Host "== Packaging $bundle"
$staging = Join-Path $env:TEMP "aeroleadai-stage-$stamp"
New-Item -ItemType Directory -Force -Path $staging | Out-Null
robocopy $root $staging /E /XD node_modules .git "$root\windows\artifacts" "$root\android\artifacts" /XF .env.local | Out-Null
Compress-Archive -Path "$staging\*" -DestinationPath $bundle -Force
Remove-Item -Recurse -Force $staging
Write-Host "OK   Bundle: $bundle"
Write-Host "     Start the app with: powershell -ExecutionPolicy Bypass -File windows\Start-AeroLeadAI.ps1"
