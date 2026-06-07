# robot-demo

End-to-end demo for the `kensho-robot` adapter.

## Run (with Robot Framework installed)

```bash
# install the adapter (editable, from the monorepo)
pip install -e ../../packages/robot

# run the suite — kensho-results/ appears next to this README
robot --listener kensho_robot.Listener tests/

# validate against the v1 schema (using the JS CLI):
node ../../packages/cli/bin/kensho.js validate kensho-results

# render the static HTML report
node ../../packages/cli/bin/kensho.js generate \
  --input kensho-results --output kensho-report

# open it
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

You can pass listener options after a colon:

```bash
robot --listener kensho_robot.Listener:output=kensho-results:project_name=Demo tests/
```

## Run (without Robot Framework installed)

A pre-baked `kensho-results-fixture/` ships next to this README — you can
exercise the rest of the toolchain (validate / generate / open) without
running Robot:

```bash
node ../../packages/cli/bin/kensho.js validate kensho-results-fixture
node ../../packages/cli/bin/kensho.js generate \
  --input kensho-results-fixture --output kensho-report
```

## What the suite covers

| Test                          | Demonstrates                                                |
| ----------------------------- | ----------------------------------------------------------- |
| `Login Happy Path`            | severity, feature, epic, owner, label, link, captured logs, `kensho.attach` for an attachment |
| `Cart Total Is Wrong`         | failing assertion → `status: 'fail'` + `errors[]`           |
| `Promo Codes Skipped`         | `Skip` keyword → `status: 'skip'`                           |
| `Search Returns Expected Count` | `[Template]` data-driven test → multiple keyword bodies under one case |
| `Logs Only`                   | Robot `Log` keyword → `case.logs[]` and step-level `logs[]` |
