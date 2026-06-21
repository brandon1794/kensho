# Changelog

All notable changes to Kensho are documented here. Kensho ships a single
coordinated version across its packages.

## 0.3.0

The "Allure parity (and then some)" release. Schema stays **`kensho/v1`** — every
new case field is optional and backward-compatible, so existing adapters and
reports keep validating. (Coordinated `0.3.0` because `kensho-vitest@0.2.0` was
already published on its own; this brings the whole fleet onto one version.)

### Added — annotation API on every live-runtime adapter
A `kensho` helper you call from inside a test, shipped across **JS/TS** (Playwright,
Jest, Vitest, Cypress, Jasmine, Cucumber.js, Appium, Detox), **Python** (pytest,
Robot), **Java** (JUnit 5, TestNG, Cucumber-JVM), **.NET** (NUnit, xUnit), **Ruby**
(RSpec, Cucumber), and **Go**:

- `Epic` / `Feature` / `Story` → Behaviors tree (+ mirrored labels)
- `Severity` / `Owner` / `Description` (Markdown) / `Tag` / `Parameter`
- `Link` / `JiraLink` (issue) / `ReferenceLink` (reference) → typed link chips
- `step()` → nested step tree
- Runtime markers: `flaky()`, `muted()`, `knownIssue(id)` → badges + Flaky board + pass-gate

All calls are no-ops outside a running test. (MSTest stays attribute-based — its
logger runs out-of-process and can't see runtime calls.)

### Added — CLI
- `kensho merge <dir…> --out <dir>` — combine sharded/parallel results into one report
- `kensho import-allure <dir> --out <dir>` — migrate `allure-results/` → Kensho v1
- `kensho summary <dir> [--format gh]` — Markdown run summary for PR comments / `$GITHUB_STEP_SUMMARY`
- `kensho export-junit <dir> --out <file>` — JUnit XML for interop / round-trip
- `generate` now captures a **source snippet** around each failure (traversal-safe;
  `--no-snippets` to skip) and assigns failure **categories** (config rules in
  `kensho.config.json`, else auto-clustered by normalized error signature)

### Added — viewer
- Markdown rendering of `case.description` (sanitized: HTML escaped, `http(s)`-only links)
- Source-snippet block on failures (failing line highlighted, language label)
- Flaky / known-issue badges (the known-issue badge deep-links to the tracker)
- Categories tab groups by `case.category`; Flaky board includes `flaky`-marked tests
- Shareable filtered URLs — search / status / tab / category restored from the hash
- "Open trace" affordance for Playwright `trace.zip` attachments
- Theme-aware brand mark (Kaizen mark on dark, transparent glyph on light)

### Schema (`kensho/v1`, additive)
- New optional case fields: `flaky`, `muted`, `category`, `sourceSnippet`

### Changed
- `engines.node` lowered to `>=18` across npm packages
- All packages bumped to **0.3.0**

## 0.2.0
`kensho-vitest` only — Vitest 3/4 support via the `onTestRunEnd` Reported Tasks API.

## 0.1.x
Initial public release: Kensho v1 schema, CLI (`generate` / `open` / `validate` /
`diff` / `badge`), zero-dependency viewer, and adapters across JS/TS, Python, Java,
.NET, Ruby, and Go.
