# Desktop UI

`apps/desktop-ui` contains the React + Vite monitoring interface used by the native Windows shell.

## Responsibilities

- Application routes and page composition
- Monitoring dashboards and domain mock data
- Device, GPS, analysis, settings, and system pages
- Charts, maps, and desktop-oriented UI states
- API transport abstraction for mock or compatible HTTP backends

## Development

```powershell
npm install
npm run dev
```

The development server listens on `http://localhost:5174/`.

## Build

```powershell
npm run build
```

The build output is written to `apps/desktop-ui/dist` and embedded into the Windows package during publish.

## Runtime Modes

- Mock mode supports UI exploration without a backend.
- HTTP mode can connect to a compatible landslide-monitoring API through runtime configuration.
