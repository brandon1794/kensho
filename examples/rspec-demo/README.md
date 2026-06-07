# rspec-demo

End-to-end demo for the `kensho-rspec` gem.

## Run

```bash
# install the gem (path-pinned to the monorepo)
bundle install

# run the suite — kensho-results/ appears next to this README
bundle exec rspec

# validate against the v1 schema (using the JS CLI):
node ../../packages/cli/bin/kensho.js validate kensho-results

# render the static HTML report
node ../../packages/cli/bin/kensho.js generate \
  --input kensho-results --output kensho-report

# open it
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

## What the suite covers

| Spec                                                   | Demonstrates                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `Login → lands on the home page…`                      | severity (`:critical`), feature, epic, owner, labels, links, nested `Kensho.step`, attachment, captured stdout |
| `Cart → totals correctly`                              | failing assertion → `status: 'fail'` + `errors[]`                |
| `Promo codes → is gated by a feature flag` (skip)      | `skip: 'reason'` → `status: 'skip'`                              |
| `Search → returns N results for X` (parameterized)     | `kensho_labels` + a manual table → `case.parameters[]`-equivalent label |
| `Profile → avatar uploads / email updates`             | nested example groups → suite chain                              |
| `Logs only`                                            | `puts` / `$stderr.write` → `case.logs[]`                         |
| `Pending feature → is not implemented yet`             | `pending` → `status: 'skip'` with the reason                     |

After running, peek at `kensho-results/run.json` and any
`kensho-results/cases/*.json` to see the shape.
