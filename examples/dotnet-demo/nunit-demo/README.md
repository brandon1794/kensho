# NUnit demo

Six tests showing the full Kensho NUnit feature set:

- `Adds_first_item_to_cart` — passing test with nested `Kensho.Step`s, a label, a link, and a category-derived feature/epic.
- `Empty_cart_shows_CTA` — failing assertion (so the report has a `fail`).
- `Saves_for_later` — `[Ignore]` → `skip`.
- `Sums_line_items(int,int,int)` — three parametrized passes via `[TestCase]`.
- `Probe_returns_inconclusive` — `Assert.Inconclusive` → `broken`. Uses `[Property]`-style metadata instead of `[Category]`.

## Run it

```bash
dotnet test
node ../../../packages/cli/bin/kensho.js validate kensho-results
node ../../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
node ../../../packages/cli/bin/kensho.js open    --report kensho-report
```

If you don't have the .NET SDK installed, the same workflow works
against `fixtures/kensho-results/` (a static snapshot in the canonical
shape).
