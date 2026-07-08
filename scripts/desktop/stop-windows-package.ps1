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

$targets = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "LandslideDesk.Win.exe" -and (
    ([string]::IsNullOrWhiteSpace($exePath) -and $_.CommandLine -like "*LandslideDesk.Win.exe*") -or
    ($exePath -and $_.ExecutablePath -eq $exePath)
  )
})

foreach ($proc in $targets) {
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
  } catch {
    if (Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue) {
      throw "failed stopping packaged Windows desktop pid=$($proc.ProcessId): $($_.Exception.Message)"
    }
  }
}

[pscustomobject]@{
  stopped = $true
  count = $targets.Count
  pids = @($targets | ForEach-Object { $_.ProcessId })
} | ConvertTo-Json -Depth 4
