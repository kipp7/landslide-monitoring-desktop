# Security Policy

## Supported Versions

The `main` branch is the only supported line for security fixes.

## Reporting A Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

If you discover a vulnerability, contact the maintainer privately through the GitHub profile associated with this repository. Include:

- A short description of the issue
- Steps to reproduce
- Impact and affected area
- Any relevant logs or screenshots with secrets removed

## Secret Handling

This public repository should never contain production credentials, private deployment configuration, access tokens, device secrets, or local `.env` files. Use `.env.example` or documentation placeholders when configuration is needed.
