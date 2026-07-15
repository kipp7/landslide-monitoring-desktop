# Architecture

Landslide Monitoring Desktop is organized as a small desktop-first workspace. The public repository keeps the runtime boundary explicit: a React monitoring interface, a Windows host, and packaging scripts.

## System Boundary

```text
Operator
  -> Windows shell (WPF + WebView2)
    -> Desktop UI (React + Vite)
      -> Mock data or compatible monitoring API
```

Historical web, mobile, backend, and deployment work is outside the maintained desktop scope. The public tree is kept small so contributors can understand the application boundary quickly.

## Applications

| Path | Responsibility |
| --- | --- |
| `apps/desktop-ui` | React + Vite monitoring interface, routes, stores, charts, maps, and mock data. |
| `apps/windows-shell` | WPF/WebView2 native host, startup preflight checks, tray behavior, installer assets. |

## Desktop UI

The UI owns the operator-facing workflows:

- Dashboard and key monitoring site overview
- Device management and command-oriented screens
- GPS deformation and monitoring views
- Analysis pages with charts, maps, and domain mock data
- Account, settings, and system state pages

The UI can run independently in development with:

```powershell
npm run dev
```

## Windows Shell

The native shell loads the UI in two modes:

- Development: reads `DESK_DEV_SERVER_URL`, usually `http://localhost:5174/`
- Packaged: loads static files from the published `web/` directory

The shell also owns Windows-specific behavior such as startup checks, native window lifecycle, packaged asset loading, and tray integration.

## Packaging Flow

1. Build `apps/desktop-ui` into `apps/desktop-ui/dist`.
2. Publish `apps/windows-shell` with .NET.
3. Copy the static UI build into the desktop package under `web/`.
4. Write package metadata under `docs/reports/`.

## Design Principles

- Keep the public repository focused on the maintained desktop client.
- Prefer clear directory names over internal abbreviations.
- Keep generated artifacts out of Git.
- Allow UI work without backend deployment through mock data.
- Keep Windows packaging reproducible through scripts.
