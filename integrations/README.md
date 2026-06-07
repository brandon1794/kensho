# Kensho ↔ Kaizen integrations

First-party glue that wraps the [Kensho](../README.md) CLI for non-CLI environments. Both packages here are **NOT yet published** — they're scaffolds for an upcoming release.

| Path | What it is |
|---|---|
| [`github-actions/kaizen-upload/`](./github-actions/kaizen-upload/) | Composite GitHub Action that runs `kensho push` (or `kensho watch` when `live: true`) on a `kensho-results/` directory produced by your test step. |
| [`vscode/`](./vscode/) | Minimal VS Code extension scaffold contributing the **Kensho: Send last run to Kaizen** command + a status-bar shortcut. Dev-host only (F5); not on the Marketplace yet. |

Both wrap `npx --yes @kaizenreport/kensho push …`, so they don't need a global install of the CLI.
