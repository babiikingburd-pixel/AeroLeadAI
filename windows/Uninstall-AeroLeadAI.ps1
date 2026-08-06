# AeroLeadAI APEX 9.6 - remove build output and dependencies (source is left intact).
param([switch]$RemoveArtifacts, [switch]$Force)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Force) {
  $answer = Read-Host "Remove node_modules and .next from $root? (y/N)"
  if ($answer -ne "y") { Write-Host "Cancelled."; exit 0 }
}
& "$PSScriptRoot\Stop-AeroLeadAI.ps1" -ErrorAction SilentlyContinue
foreach ($dir in @("node_modules", ".next")) {
  $path = Join-Path $root $dir
  if (Test-Path $path) { Write-Host "Removing $dir"; Remove-Item -Recurse -Force $path }
}
if ($RemoveArtifacts) {
  foreach ($dir in @("windows\artifacts", "android\artifacts")) {
    $path = Join-Path $root $dir
    if (Test-Path $path) { Write-Host "Removing $dir"; Remove-Item -Recurse -Force $path }
  }
}
Write-Host "Uninstall complete. Source files and .env.local were not touched."
