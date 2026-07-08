param(
  [string]$DevServerUrl = "http://localhost:5174/"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$env:DESK_DEV_SERVER_URL = $DevServerUrl
Write-Host "Starting desktop UI at $DevServerUrl" -ForegroundColor Cyan

$ui = Start-Process -FilePath "npm" -ArgumentList @("-w", "apps/desktop-ui", "run", "dev", "--", "--host", "127.0.0.1") -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 3
  dotnet run --project .\apps\windows-shell\LandslideDesk.Win\LandslideDesk.Win.csproj
}
finally {
  if ($ui -and -not $ui.HasExited) { Stop-Process -Id $ui.Id -Force }
}
