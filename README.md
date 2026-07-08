# Landslide Monitoring Desktop

[![CI](https://github.com/kipp7/landslide-monitoring-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/kipp7/landslide-monitoring-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D4.svg)](apps/windows-shell)
[![React](https://img.shields.io/badge/UI-React%20%2B%20Vite-61DAFB.svg)](apps/desktop-ui)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg)](apps/desktop-ui)

English | [简体中文](README.zh-CN.md)

Production-minded Windows desktop client for landslide monitoring, field-device supervision, and early-warning workflows.

The repository is intentionally focused: it contains the maintained desktop experience only, with a React/Vite monitoring UI and a native WPF + WebView2 Windows shell. Backend services, mobile apps, deployment infrastructure, internal work logs, and private environment material are deliberately kept out of the public project.

## Why This Project

Landslide monitoring workflows often need a dependable operator-facing client: site overview, field device status, GPS deformation trends, alert review, and packaging that can run on Windows machines used by engineering teams. This project provides that desktop layer as a clean, public, and reusable codebase.

## Highlights

- Monitoring workspace for sites, devices, GPS deformation, alerts, account screens, and system status.
- Native Windows shell with WebView2, startup preflight checks, tray support, and packaged static assets.
- Mock-data-first development so UI contributors can run the app without deploying a backend.
- Scripted packaging flow for portable Windows builds and optional installer generation.
- Professional public layout with bilingual documentation, CI, issue templates, security policy, and MIT license.

## Product Surface

| Area | Description |
| --- | --- |
| Dashboard | Operator overview for key monitoring sites and system state. |
| Device Management | Device list, command actions, diagnostics, and field status review. |
| GPS Monitoring | GPS deformation views, export paths, and threshold-oriented workflows. |
| Analysis | Visual analysis pages built around charts, maps, and domain mock data. |
| Windows Shell | WPF/WebView2 host for packaging and running the UI as a desktop app. |

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop UI | React 18, TypeScript, Vite, Ant Design |
| Visualization | ECharts, Leaflet, Three.js |
| Native shell | .NET 8, WPF, WebView2 |
| Tooling | npm workspaces, ESLint, Prettier, GitHub Actions |

## Repository Layout

```text
apps/
  desktop-ui/       React + Vite desktop monitoring interface
  windows-shell/    WPF + WebView2 host, installer assets, native startup checks
docs/
  ARCHITECTURE.md   English architecture overview
  RELEASE.md        English release and packaging guide
  zh-CN/            Chinese documentation
  reports/          Local generated reports, not release artifacts
scripts/
  desktop/          Desktop development, packaging, and verification scripts
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

Launch the native Windows shell against the dev server:

```powershell
npm run desktop:dev
```

## Build And Package

Build the React desktop UI:

```powershell
npm run build
```

Create the default Windows portable package:

```powershell
npm run desktop:publish
```

Default output:

- `artifacts/windows/portable/`
- `docs/reports/windows-package-latest.json`

## Verification

```powershell
npm audit
npm run lint
npm run build
dotnet build .\apps\windows-shell\LandslideDesk.Win\LandslideDesk.Win.csproj -c Release
```

After packaging:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\verify-windows-package.ps1
```

## Documentation

- [Documentation hub](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Release process](docs/RELEASE.md)
- [中文文档总览](docs/zh-CN/README.md)
- [中文架构说明](docs/zh-CN/ARCHITECTURE.md)
- [中文发布流程](docs/zh-CN/RELEASE.md)
- [Desktop UI package](apps/desktop-ui/README.md)
- [Windows shell package](apps/windows-shell/README.md)
- [Contributing guide](CONTRIBUTING.md)
- [中文贡献指南](CONTRIBUTING.zh-CN.md)
- [Security policy](SECURITY.md)

## Project Status

This is a desktop-client-only public repository. It is ready for UI exploration, Windows packaging, and integration with compatible landslide-monitoring APIs. Public demo datasets, screenshots, and signed release artifacts can be added as the project matures.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Released under the [MIT License](LICENSE).
