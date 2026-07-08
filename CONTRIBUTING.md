# Contributing

[简体中文](CONTRIBUTING.zh-CN.md)

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
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\verify-windows-package.ps1
```

## Pull Request Guidelines

- Keep pull requests focused on one feature or fix.
- Include screenshots or short screen recordings for UI changes.
- Update documentation when commands, setup, or behavior changes.
- Avoid committing generated outputs from `artifacts/`, `dist/`, `bin/`, or `obj/`.
- Do not commit real credentials, field deployment details, private endpoints, or local environment files.

## Project Conventions

- Use public-facing directory names such as `apps/desktop-ui` and `apps/windows-shell`.
- Keep desktop automation under `scripts/desktop`.
- Keep generated package reports under `docs/reports`.
- Update both `README.md` and `README.zh-CN.md` for project-level presentation changes.
- Prefer clear operational docs over internal work logs.

## Commit Style

Use concise conventional-style prefixes when practical:

- `feat:` for user-visible features
- `fix:` for bug fixes
- `docs:` for documentation
- `chore:` for tooling and maintenance
- `ci:` for workflow changes
