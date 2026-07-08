# Maintainers Guide

This project keeps the public repository focused on the maintained Windows desktop client. The goal is a stable, readable codebase that contributors can build locally and reviewers can trust.

## Review Principles

- Keep changes scoped to the desktop UI, Windows shell, packaging scripts, or documentation.
- Prefer small pull requests with clear screenshots for UI work.
- Do not merge generated artifacts such as `dist/`, `bin/`, `obj/`, `artifacts/`, or local reports.
- Do not publish credentials, production endpoints, private field configuration, or local environment values.
- Require the CI workflow to pass before merging.

## Dependency Updates

Dependabot is configured to open low-noise weekly updates:

- npm updates are grouped by runtime and tooling dependencies.
- GitHub Actions updates are grouped separately.
- Semver-major upgrades are ignored automatically and should be handled manually when the project is ready for a compatibility review.

When reviewing dependency changes, run:

```powershell
npm audit
npm run lint
npm run build
dotnet build .\apps\windows-shell\LandslideDesk.Win\LandslideDesk.Win.csproj -c Release
```

For packaging-related changes, also run:

```powershell
npm run desktop:publish
```

## Release Readiness

Before creating a release, confirm:

- README and `docs/` match the current desktop scope.
- `CHANGELOG.md` has a dated entry.
- The Windows package includes `web/index.html`.
- The working tree is clean after removing generated outputs.
- Main branch CI is green.
