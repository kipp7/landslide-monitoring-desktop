[CmdletBinding()]
param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64",
  [string]$SelfContainedOutputDir = "artifacts/windows/self-contained",
  [string]$InstallerOutputDir = "artifacts/windows/installer",
  [string]$Version = "0.1.0",
  [switch]$SkipDeskBuild
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Invoke-Step([string]$label, [scriptblock]$action) {
  Write-Host "==> $label" -ForegroundColor Cyan
  & $action
  if ($LASTEXITCODE -ne 0) {
    throw "$label failed (exit=$LASTEXITCODE)"
  }
}

function Get-HashEntry([string]$path) {
  $hash = Get-FileHash -Path $path -Algorithm SHA256
  return [ordered]@{
    path = $path
    sha256 = $hash.Hash.ToLowerInvariant()
    sizeBytes = (Get-Item $path).Length
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$selfContainedScript = Join-Path $repoRoot "scripts/desktop/package-windows-self-contained.ps1"
$installerScript = Join-Path $repoRoot "apps/windows-shell/installer/LandslideDesk.Win.iss"
$reportFile = Join-Path $repoRoot "docs/reports/windows-installer-latest.json"
$outDir = Join-Path $repoRoot $InstallerOutputDir
$bootstrapperDir = Join-Path $repoRoot "artifacts/windows/prerequisites"
$bootstrapperPath = Join-Path $bootstrapperDir "MicrosoftEdgeWebView2Setup.exe"
$chineseLangPath = Join-Path $repoRoot "apps/windows-shell/installer/ChineseSimplified.isl"
$isccCandidates = @(
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$iscc = @($isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1)[0]

if (-not $iscc) {
  throw "ISCC.exe not found. Install Inno Setup 6 first."
}

if (-not (Test-Path $installerScript)) {
  throw "installer script not found: $installerScript"
}

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
New-Item -ItemType Directory -Path $bootstrapperDir -Force | Out-Null

$selfContainedArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $selfContainedScript,
  "-Configuration", $Configuration,
  "-Runtime", $Runtime,
  "-OutputDir", $SelfContainedOutputDir
)
if ($SkipDeskBuild.IsPresent) {
  $selfContainedArgs += "-SkipDeskBuild"
}

Invoke-Step "Publish Windows desktop self-contained package" {
  & powershell @selfContainedArgs
}

$selfContainedManifest = Get-Content -Path (Join-Path $repoRoot "docs/reports/windows-self-contained-package-latest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceDir = Join-Path $repoRoot ([string]$selfContainedManifest.outputDir)
if (-not (Test-Path $sourceDir)) {
  throw "self-contained output not found: $sourceDir"
}

if (-not (Test-Path $bootstrapperPath)) {
  Invoke-Step "Download WebView2 bootstrapper" {
    Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $bootstrapperPath -UseBasicParsing
  }
}

if (-not (Test-Path $chineseLangPath)) {
  Invoke-Step "Download Inno Setup Chinese language file" {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/jrsoftware/issrc/main/Files/Languages/Unofficial/ChineseSimplified.isl" -OutFile $chineseLangPath -UseBasicParsing
  }
}

$buildInfoFile = Join-Path $repoRoot "docs/reports/windows-build-info-latest.json"
$buildInfo = if (Test-Path $buildInfoFile) {
  Get-Content -Path $buildInfoFile -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
  $null
}
$gitShortSha = if ($buildInfo) { [string]$buildInfo.git.shortSha } else { (git rev-parse --short HEAD).Trim() }
$outputBaseFilename = "LandslideDesk-Setup-$Runtime-$gitShortSha"
$verName = "Landslide Desk $Version ($gitShortSha)"

Invoke-Step "Compile Inno Setup installer" {
  & $iscc `
    "/DMyAppVersion=$Version" `
    "/DMyAppVerName=$verName" `
    "/DSourceDir=$sourceDir" `
    "/DOutputDir=$outDir" `
    "/DOutputBaseFilename=$outputBaseFilename" `
    "/DWebView2Bootstrapper=$bootstrapperPath" `
    $installerScript
}

$installerExe = Join-Path $outDir "$outputBaseFilename.exe"
if (-not (Test-Path $installerExe)) {
  throw "installer exe not found: $installerExe"
}

$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  configuration = $Configuration
  runtime = $Runtime
  version = $Version
  gitShortSha = $gitShortSha
  installer = [ordered]@{
    path = $installerExe
    fileName = [System.IO.Path]::GetFileName($installerExe)
  }
  selfContainedPackage = [ordered]@{
    outputDir = $SelfContainedOutputDir
    exePath = $selfContainedManifest.exe.path
    fileCount = $selfContainedManifest.package.fileCount
    totalBytes = $selfContainedManifest.package.totalBytes
  }
  prerequisites = [ordered]@{
    webView2Bootstrapper = $bootstrapperPath
    dotnetDesktopRuntimeHandledBy = "self-contained"
    webView2HandledBy = "bootstrapper"
  }
  toolchain = [ordered]@{
    iscc = $iscc
  }
  hashes = [ordered]@{
    installer = (Get-HashEntry $installerExe)
    selfContainedExe = (Get-HashEntry $selfContainedManifest.exe.path)
  }
}

$json = $result | ConvertTo-Json -Depth 8
$reportDir = Split-Path -Parent $reportFile
if ($reportDir -and -not (Test-Path $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}
Set-Content -Path $reportFile -Value $json -Encoding UTF8
$json
