# Documentation

English | [简体中文](zh-CN/README.md)

This documentation set is intentionally small and operational. It explains the desktop application layout, local development flow, and Windows packaging process.

## Start Here

| Document | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Runtime boundary, application responsibilities, and packaging flow. |
| [Release Process](RELEASE.md) | Local build, packaging, verification, and GitHub release checklist. |
| [Desktop UI](../apps/desktop-ui/README.md) | React/Vite UI package responsibilities and commands. |
| [Windows Shell](../apps/windows-shell/README.md) | WPF/WebView2 host responsibilities and packaging behavior. |
| [Contributing](../CONTRIBUTING.md) | Contribution workflow, checks, and project conventions. |
| [Maintainers Guide](../MAINTAINERS.md) | Review policy, dependency update cadence, and release readiness checks. |
| [Security](../SECURITY.md) | Vulnerability reporting and secret-handling policy. |

## Repository Conventions

- Directory names should describe product responsibility and avoid legacy shorthand.
- Generated artifacts belong under `artifacts/` and must stay out of Git.
- Local reports belong under `docs/reports/` and should be regenerated as needed.
- Documentation should be updated in English and Chinese when public-facing behavior changes.
- Pull requests should include screenshots or recordings for visible UI changes.

## Current Maintained Scope

This repository includes:

- Desktop UI source
- Windows shell source
- Installer resources
- Desktop packaging and verification scripts
- Public documentation and GitHub project metadata

Historical or unmaintained directions are kept outside this desktop repository, including:

- Backend services and deployment scripts
- Web dashboards
- Mobile apps
- Local environment files and generated artifacts
