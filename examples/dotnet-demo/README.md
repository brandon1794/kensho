# Kensho .NET demos

Three small test projects demonstrating each Kensho .NET adapter.

```
dotnet-demo/
├── nunit-demo/      KaizenReport.Kensho.NUnit
├── mstest-demo/     KaizenReport.Kensho.MSTest
└── xunit-demo/      KaizenReport.Kensho.Xunit
```

Each project contains pass / fail / skip tests, parametrized tests,
`Kensho.Step` blocks, severity, behavior, labels, links, and attachments.

## Run a demo

```bash
cd nunit-demo            # or mstest-demo / xunit-demo
dotnet test

# Then turn the results into an HTML report:
node ../../../packages/cli/bin/kensho.js validate kensho-results
node ../../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
node ../../../packages/cli/bin/kensho.js open    --report kensho-report
```

## No `dotnet` SDK on this machine?

Each demo ships a static `kensho-results/` fixture in
`fixtures/kensho-results/` produced exactly the way the adapter would
produce it (same FNV-1a stable ids, same `kensho/v1` shape). You can
validate + generate against those without installing the .NET SDK:

```bash
cd nunit-demo
node ../../../packages/cli/bin/kensho.js validate fixtures/kensho-results
node ../../../packages/cli/bin/kensho.js generate --input fixtures/kensho-results --output fixtures/kensho-report
```
