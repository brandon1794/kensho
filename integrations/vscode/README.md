# `kaizen-vscode` — VS Code extension scaffold

> **Status: NOT yet published.** This is a development scaffold. It is **not** on the VS Code Marketplace and has no `publisher` set yet (see TODO in `package.json`). Run it via the dev extension host (F5) only.

A minimal VS Code extension that uploads the latest [Kensho](../../README.md) test run from your workspace to a Kaizen workspace, in one click.

It contributes a single command and a status-bar button — no panes, no tree views. The Marketplace-ready version is a separate phase.

## Install / dev loop

```bash
# from the monorepo root
pnpm install

# open just this package in VS Code
code kensho/integrations/vscode

# inside that VS Code window, press F5 to launch the Extension Development Host.
# A second VS Code window appears with the extension loaded.
```

If you'd rather build manually:

```bash
cd kensho/integrations/vscode
pnpm run build      # → out/extension.js
```

The pre-launch task wired into `.vscode/launch.json` runs the build for you on F5.

## Commands

| Command ID | Title | What it does |
|---|---|---|
| `kaizen.sendLastRun` | **Kensho: Send last run to Kaizen** | Reads the `kensho-results/` directory in the open workspace folder and runs `npx --yes @kaizenreport/kensho push …` against your Kaizen server. Streams output to the **Kensho** output channel; updates the status bar (`Sending…` → `Done` / `Failed`). |

You can invoke it from:
- Command Palette (`Cmd/Ctrl+Shift+P` → "Kensho: Send last run to Kaizen")
- The Kensho status-bar item (cloud-upload icon, right-aligned)

## Settings

Configure under **Settings → Extensions → Kaizen** (or `settings.json`):

| Setting | Default | Notes |
|---|---|---|
| `kaizen.kenshoResultsPath` | `./kensho-results` | Workspace-relative or absolute. |
| `kaizen.workspace` | — | Kaizen workspace slug (required). |
| `kaizen.project` | — | Kaizen project slug (required). |
| `kaizen.token` | — | Fallback token. **Prefer secret storage** (see below). |
| `kaizen.server` | `https://api.kaizenreport.com` | Override for self-hosted. |
| `kaizen.kenshoVersion` | `latest` | Pin the `@kaizenreport/kensho` CLI version. |

### Storing the token securely

The first time you invoke the command without a token, the extension offers to store one in VS Code's `SecretStorage` (encrypted by the OS keychain). The setting `kaizen.token` is read only as a fallback for environments where secret storage isn't available.

To clear a stored token, run `Developer: Reload Window` after deleting it from your OS keychain, or wire a small "Forget token" command in a future iteration.

## Screenshot

> _Placeholder — drop a PNG at `docs/screenshot.png` once we have one._

## Settings reference (copy-paste)

```jsonc
// .vscode/settings.json
{
  "kaizen.kenshoResultsPath": "./kensho-results",
  "kaizen.workspace": "my-org",
  "kaizen.project": "my-app",
  "kaizen.server": "https://api.kaizenreport.com"
  // kaizen.token: leave blank — the extension will prompt and store it in SecretStorage.
}
```

## Limitations of the scaffold

- Multi-root workspaces always upload from the **first** folder. A picker would be a 5-line addition.
- No file watcher — the user runs the command manually after `playwright test` (etc.) finishes. A future iteration could subscribe to the `kensho-results/` directory and auto-trigger.
- No `vsce package` step. We're not publishing yet.
