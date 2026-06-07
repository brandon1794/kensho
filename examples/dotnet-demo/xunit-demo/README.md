# xUnit demo

Tests covering xUnit's `[Trait]`-driven metadata model: severity,
behavior, owner, free-form labels, and `Kensho.Step` blocks. Includes
parametrized rows via `[Theory]` + `[InlineData]`.

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

## Outcome detection caveat

xUnit's `BeforeAfterTestAttribute` does not receive the test outcome,
so the adapter relies on `Kensho.Step` blocks to surface failures. The
demo's `Empty_cart_shows_CTA` wraps its assertion in a step so the
failure shows up as `fail`.
