# Windows Shell

`apps/windows-shell` is the native Windows host for the desktop monitoring interface. It is built with WPF and WebView2.

## Responsibilities

- Load the Vite dev server during development.
- Load packaged static assets from `web/` in production builds.
- Provide Windows startup preflight checks.
- Own native window lifecycle and tray integration.
- Provide installer assets for Windows distribution.

## Development

Start the desktop UI and native host together:

```powershell
npm run desktop:dev
```

Or run the two parts manually:

```powershell
npm run dev
$env:DESK_DEV_SERVER_URL="http://localhost:5174/"
dotnet run --project .\apps\windows-shell\LandslideDesk.Win\LandslideDesk.Win.csproj
```

## Publish

```powershell
npm run desktop:publish
```

Default output:

- `artifacts/windows/portable/`
- `docs/reports/windows-package-latest.json`

## Verify A Package

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\verify-windows-package.ps1
```

The verifier starts the packaged executable, confirms the embedded `web/index.html` exists, then closes the process.

## Prerequisites

- Windows 10/11
- Node.js 20+
- .NET 8 SDK with Windows Desktop workload
- Microsoft Edge WebView2 Runtime
