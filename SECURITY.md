# Security Policy

## Reporting a vulnerability
Please report security issues privately via GitHub **Security → Report a
vulnerability** (Private Vulnerability Reporting) on this repository. We aim to
acknowledge within 72 hours. Do not open public issues for security reports.

## Supported versions
The latest published `0.x` release line receives security fixes.

## Notes on dependencies
The published Kensho packages ship **zero third-party runtime dependencies**
(adapters only depend on the tiny `@kaizenreport/kensho-schema`). Audit findings
in this repo come from the example/demo test frameworks (cypress, vitest,
newman, appium) and are pinned to patched versions via `pnpm.overrides`.
