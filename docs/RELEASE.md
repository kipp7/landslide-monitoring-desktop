# Release Process

## Local Package

```powershell
npm install
npm run desktop:publish
```

The default output is:

- `artifacts/desk-win/win-x64/`
- `docs/reports/desk-win-package-latest.json`

## Verify Package

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev\verify-desk-win-package.ps1
```

## Optional Installer

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev\build-desk-win-installer.ps1
```

Installer tooling may require additional local Windows packaging dependencies.

## GitHub Release Checklist

- CI passes on `main`.
- `npm run build` passes locally.
- Windows package verification passes.
- Release notes are updated in `CHANGELOG.md`.
- No generated artifacts or credentials are committed.
