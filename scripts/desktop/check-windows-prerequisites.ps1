[CmdletBinding()]
param(
  [string]$PackageManifestFile = "docs/reports/windows-package-latest.json",
  [string]$OutFile = "docs/reports/windows-prerequisites-latest.json"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fullManifest = Join-Path $repoRoot $PackageManifestFile
$fullOutFile = Join-Path $repoRoot $OutFile

function Get-WebView2Version() {
  $paths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  )

  foreach ($path in $paths) {
    try {
      $item = Get-ItemProperty -Path $path -ErrorAction Stop
      if ($item.pv) {
        return [string]$item.pv
      }
    } catch {
      continue
    }
  }

  return $null
}

function Test-CommandExists([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

$dotnetExists = Test-CommandExists "dotnet"
$dotnetRuntimes = @()
if ($dotnetExists) {
  $dotnetRuntimes = @(dotnet --list-runtimes 2>$null)
}

$desktopRuntime = @($dotnetRuntimes | Where-Object { $_ -match '^Microsoft\.WindowsDesktop\.App\s+8\.' }) | Select-Object -First 1
$webView2Version = Get-WebView2Version

$packageManifestData = $null
$packageManifestPresent = Test-Path $fullManifest
if ($packageManifestPresent) {
  $packageManifestData = Get-Content -Path $fullManifest -Raw -Encoding UTF8 | ConvertFrom-Json
}

$exePath = if ($packageManifestData) { [string]$packageManifestData.exe.path } else { $null }
$webIndex = if ($packageManifestData) { [string]$packageManifestData.web.indexPath } else { $null }

$checks = @(
  [pscustomobject]@{
    key = "dotnetCommand"
    ok = $dotnetExists
    actual = $dotnetExists
    expected = $true
  },
  [pscustomobject]@{
    key = "windowsDesktopRuntime8"
    ok = -not [string]::IsNullOrWhiteSpace($desktopRuntime)
    actual = if ($desktopRuntime) { $desktopRuntime } else { $null }
    expected = "Microsoft.WindowsDesktop.App 8.x"
  },
  [pscustomobject]@{
    key = "webView2Runtime"
    ok = -not [string]::IsNullOrWhiteSpace($webView2Version)
    actual = $webView2Version
    expected = "installed"
  },
  [pscustomobject]@{
    key = "packageManifest"
    ok = $packageManifestPresent
    actual = $packageManifestPresent
    expected = $true
  },
  [pscustomobject]@{
    key = "packagedExe"
    ok = -not [string]::IsNullOrWhiteSpace($exePath) -and (Test-Path $exePath)
    actual = $exePath
    expected = "existing exe path"
  },
  [pscustomobject]@{
    key = "packagedWebIndex"
    ok = -not [string]::IsNullOrWhiteSpace($webIndex) -and (Test-Path $webIndex)
    actual = $webIndex
    expected = "existing web/index.html"
  }
)

$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  packageManifest = $PackageManifestFile
  checks = $checks
  summary = [ordered]@{
    dotnetExists = $dotnetExists
    desktopRuntime = $desktopRuntime
    webView2Version = $webView2Version
    packageManifestPresent = $packageManifestPresent
    packagedExePath = $exePath
    packagedWebIndexPath = $webIndex
  }
}

$json = $result | ConvertTo-Json -Depth 8
$outDir = Split-Path -Parent $fullOutFile
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
Set-Content -Path $fullOutFile -Value $json -Encoding UTF8
$json
