# cucumber-ruby-demo

End-to-end demo for the `kensho-cucumber-ruby` gem.

## Run

```bash
bundle install
bundle exec cucumber

# validate against the v1 schema (using the JS CLI):
node ../../packages/cli/bin/kensho.js validate kensho-results

# render the static HTML report
node ../../packages/cli/bin/kensho.js generate \
  --input kensho-results --output kensho-report

# open it
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

## What the suite covers

| Scenario                                                          | Demonstrates                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| `Cart with two items totals correctly`                            | severity (`@critical`), labels (`@kensho.label.team`), links (`@kensho.link.jira`), data table → step parameters |
| `Promo code is applied incorrectly`                               | failing scenario → `status: 'fail'` + `errors[]`, full URL link (`@kensho.url.runbook`) |
| `Empty cart shows the empty-state message`                        | severity (`@minor`), trivially passing scenario           |

After running, peek at `kensho-results/run.json` and any
`kensho-results/cases/*.json` to see the shape.
