# Documentation

English | [简体中文](zh-CN/README.md)

This documentation set is intentionally small and operational. It explains the public desktop-client boundary, the application layout, and the local Windows packaging flow.

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

## Repository Standards

- Public directory names should describe product responsibility, not internal history.
- Generated artifacts belong under `artifacts/` and must stay out of Git.
- Local reports belong under `docs/reports/` and should be regenerated as needed.
- Documentation should be updated in English and Chinese when public-facing behavior changes.
- Pull requests should include screenshots or recordings for visible UI changes.

## Current Public Boundary

The public project includes:

- Desktop UI source
- Windows shell source
- Installer resources
- Desktop packaging and verification scripts
- Public documentation and GitHub project metadata

The public project excludes:

- Backend services
- Mobile apps
- Web dashboards
- Production infrastructure
- Private field configuration
- Internal journals, work logs, and local environment files
