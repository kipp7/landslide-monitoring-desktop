# Architecture

Landslide Monitoring Desktop is split into two layers:

## React Desktop UI

Location: `apps/desk`

The UI owns the monitoring workflows: dashboard, site overview, device management, GPS monitoring, analysis views, account screens, and system status pages. It is built with React, TypeScript, Vite, Ant Design, ECharts, Leaflet, and Three.js.

During development, the UI runs as a Vite dev server on port `5174`.

## Windows Host

Location: `apps/desk-win`

The native shell is a WPF application that embeds WebView2. In development it loads `DESK_DEV_SERVER_URL`; in packaged builds it loads static files from the published `web/` directory.

## Packaging Flow

1. Build `apps/desk` into `apps/desk/dist`.
2. Publish `apps/desk-win` with .NET.
3. Copy the static UI build into the desktop package under `web/`.
4. Write package metadata under `docs/reports/`.

## Public Repository Boundary

This repository intentionally excludes backend services, mobile apps, web dashboards, production infrastructure, internal journals, private environment files, and field deployment material. The public boundary is the maintained desktop client.
