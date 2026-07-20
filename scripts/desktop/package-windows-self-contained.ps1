[CmdletBinding()]
param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64",
  [string]$OutputDir = "artifacts/windows/self-contained",
  [string]$ApiBaseUrl = "",
  [ValidateSet("http", "mock")]
  [string]$ApiMode = "http",
  [string]$Profile = "default",
  [switch]$ForceApiConfig,
  [switch]$SkipDeskBuild
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repoRoot "apps/windows-shell/LandslideDesk.Win/LandslideDesk.Win.csproj"
$deskDistDir = Join-Path $repoRoot "apps/desktop-ui/dist"
$fullOutputDir = Join-Path $repoRoot $OutputDir
$reportFile = Join-Path $repoRoot "docs/reports/windows-self-contained-package-latest.json"

if (-not (Test-Path $project)) {
  throw "Windows shell project not found: $project"
}

if (-not $SkipDeskBuild.IsPresent) {
  if (Test-Path $deskDistDir) {
    Remove-Item -Path $deskDistDir -Recurse -Force
  }
  Push-Location $repoRoot
  try {
    npm -w apps/desktop-ui run build
    if ($LASTEXITCODE -ne 0) {
      throw "desktop UI build failed (exit=$LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

if (Test-Path $fullOutputDir) {
  Remove-Item -Path $fullOutputDir -Recurse -Force
}
New-Item -ItemType Directory -Path $fullOutputDir -Force | Out-Null

Push-Location $repoRoot
try {
  dotnet publish $project -c $Configuration -r $Runtime --self-contained true -p:PublishSingleFile=false -o $fullOutputDir
  if ($LASTEXITCODE -ne 0) {
    throw "Windows self-contained publish failed (exit=$LASTEXITCODE)"
  }
} finally {
  Pop-Location
}

$exe = Get-ChildItem -Path $fullOutputDir -Filter "LandslideDesk.Win.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  throw "Windows executable not found in output: $fullOutputDir"
}

$webIndex = Join-Path $fullOutputDir "web/index.html"
if (-not (Test-Path $webIndex)) {
  throw "Windows package missing web assets: $webIndex"
}

$normalizedApiBaseUrl = $ApiBaseUrl.Trim().TrimEnd("/")
$normalizedProfile = if ([string]::IsNullOrWhiteSpace($Profile)) { "default" } else { $Profile.Trim() }
$runtimeConfigPath = Join-Path $fullOutputDir "desk-runtime.json"
$runtimeConfigWritten = -not [string]::IsNullOrWhiteSpace($normalizedApiBaseUrl)

if ($runtimeConfigWritten) {
  $runtimeConfig = [ordered]@{
    profile = $normalizedProfile
    api = [ordered]@{
      mode = $ApiMode
      baseUrl = $normalizedApiBaseUrl
      force = $ForceApiConfig.IsPresent
    }
  }
  $runtimeConfig | ConvertTo-Json -Depth 6 | Set-Content -Path $runtimeConfigPath -Encoding UTF8
}

$files = Get-ChildItem -Path $fullOutputDir -Recurse -File
$manifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  configuration = $Configuration
  runtime = $Runtime
  outputDir = $OutputDir
  selfContained = $true
  exe = [ordered]@{
    path = $exe.FullName
    sizeBytes = [int64]$exe.Length
  }
  web = [ordered]@{
    indexPath = $webIndex
    indexPresent = $true
    fileCount = @($files | Where-Object { $_.FullName -like "*\web\*" }).Count
  }
  api = [ordered]@{
    configured = $runtimeConfigWritten
    configPath = if ($runtimeConfigWritten) { $runtimeConfigPath } else { $null }
    profile = $normalizedProfile
    mode = $ApiMode
    baseUrl = if ($runtimeConfigWritten) { $normalizedApiBaseUrl } else { $null }
    force = $runtimeConfigWritten -and $ForceApiConfig.IsPresent
  }
  package = [ordered]@{
    fileCount = @($files).Count
    totalBytes = (@($files | Measure-Object -Property Length -Sum).Sum)
  }
}

$json = $manifest | ConvertTo-Json -Depth 8
$reportDir = Split-Path -Parent $reportFile
if ($reportDir -and -not (Test-Path $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
}
Set-Content -Path $reportFile -Value $json -Encoding UTF8
Set-Content -Path (Join-Path $fullOutputDir "windows-self-contained-package-manifest.json") -Value $json -Encoding UTF8

$json
