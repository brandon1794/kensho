# go-demo

End-to-end demo for the `@kaizenreport/kensho-go` adapter.

## Run (with Go installed)

```bash
go test -json ./... > out.json
node ../../packages/go/bin/kensho-go.js --input out.json --output kensho-results
node ../../packages/cli/bin/kensho.js validate kensho-results
node ../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

Or in one shot, piping the JSON stream straight in:

```bash
go test -json ./... | node ../../packages/go/bin/kensho-go.js --output kensho-results
```

## Run (without Go installed)

A hand-trimmed `out.json` ships next to this README so you can exercise the
converter without running Go. The fixture mirrors what
`go test -json ./internal` would emit for the suite under `internal/`.

```bash
node ../../packages/go/bin/kensho-go.js --input out.json --output kensho-results
node ../../packages/cli/bin/kensho.js validate kensho-results
node ../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
```

## What the suite covers

| Test                              | Demonstrates                                              |
| --------------------------------- | --------------------------------------------------------- |
| `TestLoginHappyPath`              | severity, feature, epic, labels, link, nested `kensho.Step`, captured stdout |
| `TestCartTotalIsWrong`            | failing assertion → `status: 'fail'` + `errors[]`         |
| `TestPromoCodes`                  | `t.Skip` → `status: 'skip'`                               |
| `TestSearchReturnsExpectedCount`  | `t.Run` sub-tests with `kensho.Parameter` for table-driven inputs (each sub-test is its own Kensho case by default) |
| `TestPanicsAreFails`              | a runtime panic in the test → `status: 'fail'` and `errors[].type = 'panic'` |

## Sub-test mode

By default each `t.Run("name", …)` sub-test becomes its own Kensho case (so
the dashboard sees the full table-driven matrix). Pass `--subtests=children`
to fold them into nested steps under the parent test instead:

```bash
node ../../packages/go/bin/kensho-go.js --input out.json --output kensho-results --subtests=children
```
