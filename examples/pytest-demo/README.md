# pytest-demo

End-to-end demo for the `kensho-pytest` adapter.

## Run

```bash
# install the adapter (editable, from the monorepo)
pip install -e ../../packages/pytest

# run the suite — kensho-results/ appears next to this README
pytest

# validate against the v1 schema (using the JS CLI):
node ../../packages/cli/bin/kensho.js validate kensho-results

# render the static HTML report
node ../../packages/cli/bin/kensho.js generate \
  --input kensho-results --output kensho-report

# open it
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

## What the suite covers

| Test                                         | Demonstrates                                                    |
| -------------------------------------------- | --------------------------------------------------------------- |
| `test_login_happy_path`                      | severity, feature, epic, owner, description, labels, links, nested `kensho.step`, attachment, captured stdout |
| `test_cart_total_is_wrong`                   | failing assertion → `status: 'fail'` + `errors[]`               |
| `test_promo_codes_skipped`                   | `pytest.mark.skip` → `status: 'skip'`                           |
| `test_search_returns_expected_count`         | `pytest.mark.parametrize` → `case.parameters[]`                 |
| `TestProfile.test_*`                         | class-based suite chain                                         |
| `test_xfail_demo`                            | `pytest.mark.xfail` → still a `pass`                            |
| `test_logs_only`                             | captured stdout/stderr → `case.logs[]`                          |

After running, peek at `kensho-results/run.json` and any
`kensho-results/cases/*.json` to see the shape.
