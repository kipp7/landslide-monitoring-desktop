# Contributing

Thanks for helping improve Landslide Monitoring Desktop.

## Development Setup

```powershell
npm install
npm run dev
```

For the native Windows host:

```powershell
npm run desktop:dev
```

## Before Opening A Pull Request

Run the checks that match your change:

```powershell
npm run lint
npm run build
```

For Windows packaging changes, also run:

```powershell
npm run desktop:publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev\verify-desk-win-package.ps1
```

## Pull Request Guidelines

- Keep pull requests focused on one feature or fix.
- Include screenshots or short screen recordings for UI changes.
- Update documentation when commands, setup, or behavior changes.
- Avoid committing generated outputs from `artifacts/`, `dist/`, `bin/`, or `obj/`.
- Do not commit real credentials, field deployment details, private endpoints, or local environment files.

## Commit Style

Use concise conventional-style prefixes when practical:

- `feat:` for user-visible features
- `fix:` for bug fixes
- `docs:` for documentation
- `chore:` for tooling and maintenance
- `ci:` for workflow changes
