# Windows Desktop Host

The `apps/desk-win` project is a native Windows shell built with WPF and WebView2. It loads the React desktop UI from a local dev server during development and from packaged static assets in production builds.

## Development

Start the desktop UI and native host together:

```powershell
npm run desktop:dev
```

Or run the two parts manually:

```powershell
npm run dev
$env:DESK_DEV_SERVER_URL="http://localhost:5174/"
dotnet run --project .\apps\desk-win\LandslideDesk.Win\LandslideDesk.Win.csproj
```

## Publish

Build the React UI and publish the Windows host:

```powershell
npm run desktop:publish
```

Default output:

- `artifacts/desk-win/win-x64/`
- `docs/reports/desk-win-package-latest.json`

## Verify A Package

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev\verify-desk-win-package.ps1
```

The verifier starts the packaged executable, confirms the embedded `web/index.html` exists, then closes the process.

## Prerequisites

- Windows 10/11
- Node.js 20+
- .NET 8 SDK with Windows Desktop workload
- Microsoft Edge WebView2 Runtime
