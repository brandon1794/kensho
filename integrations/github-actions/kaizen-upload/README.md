# `kaizenreport/kaizen-upload` — GitHub Action

> **Status: NOT yet published.** This action is part of an in-development integration. The `uses:` reference below will start working once we cut a `v1` tag in the public `kaizenreport/kaizen-upload` repo. Until then, copy `action.yml` into your own repo and reference it locally with `uses: ./path/to/kaizen-upload`.

A composite GitHub Action that uploads a [Kensho](../../../README.md) test run to a [Kaizen](https://kaizenreport.com) workspace. It wraps `npx @kaizenreport/kensho push` (or `watch`, when `live: true`) so you don't need to install the CLI globally on the runner.

## Usage

```yaml
- name: Upload Kensho run to Kaizen
  uses: kaizenreport/kaizen-upload@v1
  with:
    kensho-results-path: ./kensho-results
    workspace-slug: my-org
    project-slug: my-app
    kaizen-token: ${{ secrets.KAIZEN_TOKEN }}
    live: false                            # default — single upload after tests
    server: https://api.kaizenreport.com   # default
```

See [`.github/SAMPLE-workflow.yml`](./.github/SAMPLE-workflow.yml) for a full pipeline (checkout → setup-node → install → playwright test → upload).

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `kensho-results-path` | no | `./kensho-results` | Path to the Kensho results directory produced by your reporter. |
| `workspace-slug` | yes | — | Kaizen workspace slug (the `my-org` part of `kaizenreport.com/my-org/...`). |
| `project-slug` | yes | — | Kaizen project slug. |
| `kaizen-token` | yes | — | Kaizen API token (`kz_…`). **Always pass via `secrets.*`**. |
| `live` | no | `false` | When `true`, runs `kensho watch` (streams steps as they complete). When `false`, runs `kensho push` (single upload at the end). |
| `server` | no | `https://api.kaizenreport.com` | Kaizen API base URL. Override for self-hosted. |
| `kensho-version` | no | `latest` | Pin the `@kaizenreport/kensho` CLI version installed by `npx`. |

## Setting up the secret

1. Go to your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name it `KAIZEN_TOKEN` and paste your `kz_…` token from Kaizen → Settings → API tokens.
4. Reference it in your workflow as `${{ secrets.KAIZEN_TOKEN }}` (as in the sample above).

The action re-applies `::add-mask::` to the token for defense-in-depth, so even if it ever appears in logs (e.g. via `set -x`) it will be redacted.

## Live mode caveat (`live: true`)

`live: true` switches the underlying CLI from `push` to `watch`. `watch` streams test events to Kaizen as they complete, which is great for long suites where you want to see results land in real time. Trade-offs:

- Uses a longer-lived HTTP connection — flakier on runners with strict idle timeouts.
- Counts each streamed event toward your Kaizen API quota; `push` is a single request.
- If the runner is killed mid-suite, partial results are persisted server-side. With `push`, a killed runner means no upload at all.

For most CI pipelines, leave `live: false` (the default).

## Pin to a SHA, not a tag

For security-conscious orgs, **pin this action to a full commit SHA** rather than `@v1`. Tags are mutable; SHAs are not. Renovate / Dependabot can keep the SHA fresh.

```yaml
# Good (immutable)
uses: kaizenreport/kaizen-upload@7c4d3f9a2b1e6d8f5a9c3e2b1f4d7e8a9c2b3d5e

# Convenient but mutable (a malicious tag move would compromise your pipeline)
uses: kaizenreport/kaizen-upload@v1
```

## Smoke test

`__test__/dry-run.sh` simulates the action locally without contacting Kaizen, so you can verify the input-validation guards behave (friendly error on missing `kensho-results/`, etc.). See that script's header comment for usage.
