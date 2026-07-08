# Desktop UI

The `apps/desk` package contains the React + Vite desktop interface used by the native Windows shell.

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

The build output is written to `apps/desk/dist` and is embedded into the Windows application during publish.

## Runtime Modes

- Mock mode is available for UI exploration without a backend.
- HTTP mode can be wired to a compatible landslide-monitoring API through the app runtime configuration.
