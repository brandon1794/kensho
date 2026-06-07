# testng-demo

End-to-end demo for `@kaizenreport/kensho-testng`.

## Run with Maven

```bash
mvn test
node ../../packages/cli/bin/kensho.js validate kensho-results
node ../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

## Run without Maven

A checked-in `fixtures/kensho-results/` covers the same tests as the Maven
project so the CLI can be validated on machines without a JVM. (The repo's
top-level `.gitignore` excludes `kensho-results/` directly, so the demo
parks its committed fixture under `fixtures/`.)

```bash
node ../../packages/cli/bin/kensho.js validate fixtures/kensho-results
node ../../packages/cli/bin/kensho.js generate --input fixtures/kensho-results --output kensho-report
```

## What's exercised

| Scope                                     | Test                                              |
| ----------------------------------------- | ------------------------------------------------- |
| pass + nested `Kensho.step`               | `CartTest.addItem`                                |
| fail (`Assert.fail`)                      | `CartTest.checkoutFails`                          |
| skip (`SkipException`)                    | `CartTest.skipUnsupported`                        |
| `@DataProvider` (parametrized)            | `PricingTest.appliesDiscount` (×2)                |
| Severity from `@Test(groups={"blocker"})` | `CartTest.checkoutFails`                          |
| Severity from `@Severity` shorthand (`@Minor`) | `PricingTest.appliesDiscount`                |
| Severity from group + `@Severity` mix     | `CartTest.addItem` (`critical` group)             |
| `@Epic` / `@Feature` / `@Story`           | `CartTest`                                        |
| Class-level `@Owner`                      | `CartTest`                                        |
| Non-severity groups become `case.tags[]`  | `regression`, `smoke`                             |
| `@Link` annotation                        | `CartTest.addItem` (Jira CART-1)                  |
| `Kensho.label`                            | `CartTest.addItem`                                |
| Captured params in `case.parameters[]`    | `PricingTest.appliesDiscount`                     |
