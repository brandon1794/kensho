# @kaizenreport/kensho-go

Convert `go test -json` output into a [Kensho v1](../schema) results bundle so
the Kensho CLI can render a rich static HTML report.

Go's standard test runner has no plugin system, so this adapter ships as a
**Node-based CLI** that consumes the structured JSON `go test` already emits.
Drop the optional `go-helper` module into your test code if you want
first-class steps, attachments, labels and links — same shape as
`kensho-pytest` and the JS adapters.

## One-liner

```bash
go test -json ./... | npx kensho-go --output kensho-results
npx kensho generate
npx kensho open
```

## Install

```bash
pnpm add -D @kaizenreport/kensho-go @kaizenreport/kensho
# or
npm install --save-dev @kaizenreport/kensho-go @kaizenreport/kensho
```

## Usage

```bash
# pipe the JSON stream straight in
go test -json ./... | npx kensho-go --output kensho-results

# or save it first (handy in CI for re-runnable conversions)
go test -json ./... > gotest.json
npx kensho-go --input gotest.json --output kensho-results

# merge multiple files
npx kensho-go --input unit.json --input integration.json --output kensho-results
```

| Flag                            | Effect                                                    |
| ------------------------------- | --------------------------------------------------------- |
| `--input <file>`, `-i`          | Read events from a file. Pass multiple times to merge.    |
| `--output <dir>`, `-o`          | Output directory (default `kensho-results`).              |
| `--project-name <name>`         | Project name to embed in `run.json`.                      |
| `--project-slug <slug>`         | Project slug for the platform.                            |
| `--run-id <id>`                 | Override the auto-generated run id.                       |
| `--subtests cases\|children`    | `cases` (default) — every `t.Run` becomes its own case. `children` — sub-tests roll up as nested steps under the parent. |

## Mapping (`go test -json` → Kensho)

| Action       | Effect                                                        |
| ------------ | ------------------------------------------------------------- |
| `run`        | Open a case (or sub-case) with its `startedAt`.               |
| `output`     | Append the line to `case.logs[]`. `KENSHO_META:` lines from the helper module are parsed out separately. |
| `pass`       | Close the case with `status: 'pass'` and `duration` from `Elapsed`. |
| `fail`       | Close with `status: 'fail'`. The captured output becomes `errors[].stack`. |
| `skip`       | Close with `status: 'skip'`.                                  |
| `panic:` in output | Forces `status: 'fail'` (Go has no `broken` concept; the converter reserves it for events with no terminal action — usually a build failure). |

Stable case IDs come from `<Package>::<Test>` hashed via the same FNV-1a-based
algorithm the JS adapters use, so a Go package's history lines up with other
runs of the same suite on the platform.

Severity is detected from the test name (`Test_blocker_*`, `Test_critical_*`,
…) or from sub-test names (`t.Run("severity:critical", …)`, `t.Run("@critical")`).
Inline `@tag` substrings in the test name become `case.tags`.

## Optional Go helper module

For first-class metadata, drop the helper module under `packages/go/go-helper/`
into your project (it's a separate Go module — `go get` it directly from this
repo, or vendor it):

```go
package mything

import (
    "testing"
    kensho "github.com/kaizenreport/kensho-go-helper"
)

func TestLoginHappyPath(t *testing.T) {
    kensho.Severity(t, "critical")
    kensho.Feature(t, "Authentication")
    kensho.Label(t, "team", "growth")
    kensho.Link(t, "https://jira.example.com/browse/PROJ-123",
        kensho.LinkOpts{Kind: "jira", Label: "PROJ-123"})

    kensho.Step(t, "open the login page", func() {
        kensho.Step(t, "warm up CDN", func() {
            // …
        })
    })

    kensho.Step(t, "submit credentials", func() {
        // …
    })

    kensho.Attach(t, "/tmp/login.png", kensho.AttachOpts{Kind: "screenshot"})
}
```

| Helper                                     | What it does                                            |
| ------------------------------------------ | ------------------------------------------------------- |
| `kensho.Step(t, title, func() { … })`      | Opens a Kensho step. Nests automatically. Marks `fail` on panic or `t.Failed()`. |
| `kensho.Attach(t, path, opts…)`            | Registers a file. The Node CLI copies it into `kensho-results/attachments/<caseId>/`. |
| `kensho.Label(t, key, value)`              | Adds a free-form `key=value` to `case.labels`.          |
| `kensho.Link(t, url, opts…)`               | Adds a hyperlink.                                       |
| `kensho.Severity(t, value)`                | Sets `case.severity`.                                   |
| `kensho.Feature/Epic/Scenario(t, value)`   | Populates `case.behavior.*`.                            |
| `kensho.Tag(t, value)`                     | Adds a tag.                                             |
| `kensho.Parameter(t, name, value, opts…)`  | Records a parameter (table-driven inputs).              |

The helper writes nothing to stdout — only `KENSHO_META: {...}` lines via
`t.Logf`. Outside of `go test -json` the lines are harmless test log output.

## Why a Node CLI?

Go's std `testing` package doesn't expose a plugin / reporter API, but
`go test -json` is a stable, structured stream. Routing through the same
Node CLI used by the rest of the toolchain keeps the install footprint
zero-Go-dependency for the converter and zero-Node-dependency for users
who only want the helper module.

## License

Apache-2.0.
