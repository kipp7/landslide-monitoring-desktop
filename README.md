# Landslide Monitoring Desktop

[![CI](https://github.com/kipp7/landslide-monitoring-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/kipp7/landslide-monitoring-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D4.svg)](apps/desk-win)
[![React](https://img.shields.io/badge/UI-React%20%2B%20Vite-61DAFB.svg)](apps/desk)

A focused Windows desktop client for landslide monitoring and early-warning workflows. The app combines a React/Vite monitoring interface with a native WPF + WebView2 shell, so field teams can use a polished desktop experience while keeping the UI layer web-native and easy to iterate.

## Highlights

- Real-time-style dashboard for monitoring sites, devices, GPS deformation, alert review, and system status.
- Windows desktop shell with WebView2, tray integration, startup preflight checks, and packaged static assets.
- Mock-data first development path, so contributors can explore the UI without deploying a backend.
- Scripted Windows publish flow for producing a distributable desktop package.
- Small, desktop-only repository extracted from a larger internal monorepo for public maintenance.

## Screenshots

Screenshots are not committed yet because this repository was sanitized for public release. Add product screenshots under `docs/assets/` when a public demo dataset and visual review are ready.

## Tech Stack

- UI: React 18, TypeScript, Vite, Ant Design, ECharts, Leaflet, Three.js
- Desktop host: .NET 8, WPF, WebView2
- Tooling: npm workspaces, ESLint, Prettier, GitHub Actions

## Repository Layout

```text
apps/
  desk/       React + Vite desktop UI
  desk-win/   WPF + WebView2 Windows shell and installer assets
scripts/
  desktop/    contributor convenience scripts
  dev/        desktop publish and verification scripts
docs/
  reports/    generated local build reports, ignored by release artifacts
```

## Requirements

- Windows 10/11
- Node.js 20+
- npm 10+
- .NET 8 SDK with Windows Desktop support
- Microsoft Edge WebView2 Runtime

## Quick Start

```powershell
git clone https://github.com/kipp7/landslide-monitoring-desktop.git
cd landslide-monitoring-desktop
npm install
npm run dev
```

The UI dev server starts at `http://localhost:5174/`.

To launch the native Windows host against the dev server:

```powershell
npm run desktop:dev
```

## Build

Build the React desktop UI:

```powershell
npm run build
```

Publish the Windows desktop package:

```powershell
npm run desktop:publish
```

The default package output is written to `artifacts/desk-win/win-x64/`, with a local manifest at `docs/reports/desk-win-package-latest.json`.

## Verification

```powershell
npm run lint
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev\check-desk-win-prerequisites.ps1
```

After publishing, verify the packaged executable:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev\verify-desk-win-package.ps1
```

## Project Status

This repository currently maintains the desktop client only. Web, mobile, backend services, deployment infrastructure, internal logs, and private environment material were intentionally left out of the public release.

The app is suitable for UI exploration, desktop packaging, and integration with compatible landslide-monitoring APIs. Public demo data and installable releases can be added as the project matures.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Please do not open public issues for security reports. Use the process in [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).
