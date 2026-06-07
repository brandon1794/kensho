# MSTest demo

Tests covering MSTest's full attribute surface: `[Priority]` mapped to
severity, `[DataRow]` parameterization, `[TestCategory]` prefixed
behavior tags, `[TestProperty]` free-form metadata, and `Kensho.Step`
blocks.

## Run it

```bash
dotnet test --logger 'kensho;ProjectName=Kensho MSTest Demo;ProjectSlug=kensho-mstest-demo'

node ../../../packages/cli/bin/kensho.js validate kensho-results
node ../../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
node ../../../packages/cli/bin/kensho.js open    --report kensho-report
```

If you don't have the .NET SDK installed, the same workflow works
against `fixtures/kensho-results/` (a static snapshot in the canonical
shape).
