[CmdletBinding()]
param(
  [string]$PackageManifestFile = "docs/reports/windows-package-latest.json"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fullManifest = Join-Path $repoRoot $PackageManifestFile

if (-not (Test-Path $fullManifest)) {
  throw "Windows package manifest not found: $PackageManifestFile"
}

$manifest = Get-Content -Path $fullManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$exePath = [string]$manifest.exe.path
$webIndex = [string]$manifest.web.indexPath

if (-not $exePath -or -not (Test-Path $exePath)) {
  throw "packaged exe not found: $exePath"
}

if (-not $webIndex -or -not (Test-Path $webIndex)) {
  throw "packaged web assets missing: $webIndex"
}

$existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "LandslideDesk.Win.exe" -and $_.ExecutablePath -eq $exePath
} | Select-Object -First 1

if ($existing) {
  [pscustomobject]@{
    started = $false
    alreadyRunning = $true
    pid = $existing.ProcessId
    exePath = $exePath
  } | ConvertTo-Json -Depth 4
  exit 0
}

Remove-Item Env:DESK_DEV_SERVER_URL -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Parent $exePath) -PassThru

[pscustomobject]@{
  started = $true
  alreadyRunning = $false
  pid = $proc.Id
  exePath = $exePath
} | ConvertTo-Json -Depth 4
