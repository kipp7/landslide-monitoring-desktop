[CmdletBinding()]
param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64",
  [string]$OutputDir = "artifacts/desk-win/win-x64",
  [switch]$SkipDeskBuild
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repoRoot "apps/desk-win/LandslideDesk.Win/LandslideDesk.Win.csproj"
$fullOutputDir = Join-Path $repoRoot $OutputDir
$reportFile = Join-Path $repoRoot "docs/reports/desk-win-package-latest.json"

if (-not (Test-Path $project)) {
  throw "desk-win project not found: $project"
}

if (-not $SkipDeskBuild.IsPresent) {
  Push-Location $repoRoot
  try {
    npm -w apps/desk run build
    if ($LASTEXITCODE -ne 0) {
      throw "desk build failed (exit=$LASTEXITCODE)"
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
  dotnet publish $project -c $Configuration -r $Runtime --self-contained false -o $fullOutputDir
  if ($LASTEXITCODE -ne 0) {
    throw "desk-win publish failed (exit=$LASTEXITCODE)"
  }
} finally {
  Pop-Location
}

$exe = Get-ChildItem -Path $fullOutputDir -Filter "LandslideDesk.Win.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  throw "desk-win exe not found in output: $fullOutputDir"
}

$webIndex = Join-Path $fullOutputDir "web/index.html"
if (-not (Test-Path $webIndex)) {
  throw "desk-win package missing web assets: $webIndex"
}

$files = Get-ChildItem -Path $fullOutputDir -Recurse -File
$manifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  configuration = $Configuration
  runtime = $Runtime
  outputDir = $OutputDir
  exe = [ordered]@{
    path = $exe.FullName
    sizeBytes = [int64]$exe.Length
  }
  web = [ordered]@{
    indexPath = $webIndex
    indexPresent = $true
    fileCount = @($files | Where-Object { $_.FullName -like "*\web\*" }).Count
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
Set-Content -Path (Join-Path $fullOutputDir "desk-win-package-manifest.json") -Value $json -Encoding UTF8

$json

