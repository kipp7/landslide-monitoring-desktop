[CmdletBinding()]
param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64",
  [string]$SourceDir = "artifacts/windows/portable",
  [string]$OutputDir = "artifacts/windows/installer-polished",
  [string]$Version = "0.1.0",
  [ValidateSet("online", "offline")]
  [string]$WebView2Mode = "offline"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Invoke-Step([string]$label, [scriptblock]$action) {
  Write-Host "==> $label" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $action
  if ($LASTEXITCODE -ne 0) {
    throw "$label failed (exit=$LASTEXITCODE)"
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourcePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $SourceDir))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDir))
$coreOutputPath = Join-Path $outputPath "core"
$baOutputPath = Join-Path $outputPath "build\customba"
$payloadOutputPath = Join-Path $outputPath "build\payload-self-contained"
$installerScript = Join-Path $repoRoot "apps/windows-shell/installer/LandslideDesk.Win.iss"
$desktopProject = Join-Path $repoRoot "apps/windows-shell/LandslideDesk.Win/LandslideDesk.Win.csproj"
$bundleSource = Join-Path $repoRoot "apps/windows-shell/installer-customba/Bundle.wxs"
$bundleBasePath = Split-Path -Parent $bundleSource
$baProject = Join-Path $repoRoot "apps/windows-shell/installer-customba/LandslideDesk.CustomBA.csproj"
$bootstrapperPath = if ($WebView2Mode -eq "offline") {
  Join-Path $repoRoot "artifacts/windows/prerequisites/MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
} else {
  Join-Path $repoRoot "artifacts/windows/prerequisites/MicrosoftEdgeWebView2Setup.exe"
}
$chineseLangPath = Join-Path $repoRoot "apps/windows-shell/installer/ChineseSimplified.isl"
$wixBalExtension = Join-Path $env:USERPROFILE ".nuget/packages/wixtoolset.bootstrapperapplications.wixext/6.0.2/wixext6/WixToolset.BootstrapperApplications.wixext.dll"
$isccCandidates = @(
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$iscc = @($isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1)[0]

if (-not (Test-Path $sourcePath)) { throw "installer source not found: $sourcePath" }
if (-not (Test-Path (Join-Path $sourcePath "LandslideDesk.Win.exe"))) { throw "desktop executable not found in source: $sourcePath" }
if (-not $iscc) { throw "ISCC.exe not found. Install Inno Setup 6 first." }
if (-not (Test-Path $wixBalExtension)) { throw "WiX BootstrapperApplications extension not found: $wixBalExtension" }

New-Item -ItemType Directory -Path $coreOutputPath -Force | Out-Null
New-Item -ItemType Directory -Path $baOutputPath -Force | Out-Null
New-Item -ItemType Directory -Path $payloadOutputPath -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $bootstrapperPath) -Force | Out-Null

if (-not (Test-Path $bootstrapperPath)) {
  Invoke-Step "Download WebView2 $WebView2Mode installer" {
    $webView2Uri = if ($WebView2Mode -eq "offline") {
      "https://go.microsoft.com/fwlink/?linkid=2124701"
    } else {
      "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    }
    Invoke-WebRequest -Uri $webView2Uri -OutFile $bootstrapperPath -UseBasicParsing
  }
}

if (-not (Test-Path $chineseLangPath)) {
  Invoke-Step "Download Inno Setup Chinese language file" {
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/jrsoftware/issrc/main/Files/Languages/Unofficial/ChineseSimplified.isl" -OutFile $chineseLangPath -UseBasicParsing
  }
}

$portableHashesBefore = Get-ChildItem -LiteralPath $sourcePath -File -Recurse |
  ForEach-Object { [ordered]@{ path = $_.FullName.Substring($sourcePath.Length).TrimStart('\'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } }

Invoke-Step "Publish desktop runtime as self-contained payload" {
  dotnet publish $desktopProject -c $Configuration -r $Runtime --self-contained true -p:PublishSingleFile=false -o $payloadOutputPath
}

# The product UI is Simplified Chinese. Other WPF satellite-resource cultures are not runtime dependencies.
Get-ChildItem -LiteralPath $payloadOutputPath -Directory |
  Where-Object { $_.Name -match '^[a-z]{2}(-[A-Z][a-zA-Z]+)?$' -and $_.Name -ne 'zh-Hans' } |
  Remove-Item -Recurse -Force

# Keep the already accepted portable UI, runtime configuration, diagnostics, and manifests unchanged.
$payloadWebPath = Join-Path $payloadOutputPath "web"
if (Test-Path -LiteralPath $payloadWebPath) {
  Remove-Item -LiteralPath $payloadWebPath -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $sourcePath "web") -Destination $payloadOutputPath -Recurse -Force

$sourceWebHashes = Get-ChildItem -LiteralPath (Join-Path $sourcePath "web") -File -Recurse |
  ForEach-Object { [ordered]@{ path = $_.FullName.Substring((Join-Path $sourcePath "web").Length).TrimStart('\'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } } |
  Sort-Object path
$payloadWebHashes = Get-ChildItem -LiteralPath $payloadWebPath -File -Recurse |
  ForEach-Object { [ordered]@{ path = $_.FullName.Substring($payloadWebPath.Length).TrimStart('\'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } } |
  Sort-Object path
if (($sourceWebHashes | ConvertTo-Json -Compress) -ne ($payloadWebHashes | ConvertTo-Json -Compress)) {
  throw "installer web payload does not exactly match portable web assets"
}
foreach ($preservedFile in @("desk-runtime.json", "windows-package-manifest.json", "LandslideDesk.Win.pdb")) {
  $preservedPath = Join-Path $sourcePath $preservedFile
  if (Test-Path $preservedPath) {
    Copy-Item -LiteralPath $preservedPath -Destination (Join-Path $payloadOutputPath $preservedFile) -Force
  }
}

$portableHashesAfter = Get-ChildItem -LiteralPath $sourcePath -File -Recurse |
  ForEach-Object { [ordered]@{ path = $_.FullName.Substring($sourcePath.Length).TrimStart('\'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } }
if (($portableHashesBefore | ConvertTo-Json -Compress) -ne ($portableHashesAfter | ConvertTo-Json -Compress)) {
  throw "portable source changed during installer build"
}

$coreName = "LandslideDesk-Setup-core-$Runtime"
Invoke-Step "Compile self-contained desktop payload into core installer" {
  & $iscc `
    "/DMyAppVersion=$Version" `
    "/DMyAppVerName=山体滑坡监测桌面端 $Version" `
    "/DSourceDir=$payloadOutputPath" `
    "/DOutputDir=$coreOutputPath" `
    "/DOutputBaseFilename=$coreName" `
    "/DWebView2Bootstrapper=$bootstrapperPath" `
    $installerScript
}

$coreInstallerPath = Join-Path $coreOutputPath "$coreName.exe"
Invoke-Step "Publish polished bootstrapper UI" {
  dotnet publish $baProject `
    -c $Configuration `
    -r $Runtime `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -o $baOutputPath
}

$bundleVersion = $Version
if ($bundleVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') {
  $bundleVersion = "$Version.0"
}
$installerFlavor = if ($WebView2Mode -eq "offline") { "Full-Offline" } else { "Standard-Online" }
$finalInstaller = Join-Path $outputPath "LandslideDesk-$installerFlavor-$Runtime-$Version.exe"

Invoke-Step "Build polished installer" {
  wix build $bundleSource `
    -arch x64 `
    -b $bundleBasePath `
    -ext $wixBalExtension `
    -d "CoreInstallerPath=$coreInstallerPath" `
    -d "CustomBAOutputDir=$baOutputPath" `
    -d "BundleVersion=$bundleVersion" `
    -d "AppVersion=$Version" `
    -o $finalInstaller
}

$result = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  sourceDir = $sourcePath
  payloadDir = $payloadOutputPath
  outputDir = $outputPath
  installer = [ordered]@{
    path = $finalInstaller
    sizeBytes = (Get-Item $finalInstaller).Length
    sha256 = (Get-FileHash $finalInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  payloadPolicy = [ordered]@{
    portableModified = $false
    desktopRuntime = "self-contained-net8-$Runtime"
    webView2 = if ($WebView2Mode -eq "offline") { "offline-evergreen-x64" } else { "online-bootstrapper" }
    pdbPreserved = $true
    manifestsPreserved = $true
    localPathsPreserved = $true
  }
}

$result | ConvertTo-Json -Depth 5
