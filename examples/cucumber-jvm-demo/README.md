# cucumber-jvm-demo

End-to-end demo for `@kaizenreport/kensho-cucumber-jvm`.

## Run with Maven

```bash
mvn test
node ../../packages/cli/bin/kensho.js validate kensho-results
node ../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

The plugin is wired explicitly in `RunCucumberTest.java` via
`@ConfigurationParameter(key = PLUGIN_PROPERTY_NAME, ...)` so the demo works
on Cucumber 7.x even when the SPI auto-load isn't picked up.

## Run without Maven

A checked-in `fixtures/kensho-results/` mirrors what running `mvn test` would
produce. Validate / generate without a JVM (the top-level `.gitignore` excludes
`kensho-results/`, so the demo parks its committed fixture under `fixtures/`):

```bash
node ../../packages/cli/bin/kensho.js validate fixtures/kensho-results
node ../../packages/cli/bin/kensho.js generate --input fixtures/kensho-results --output kensho-report
```

## What's exercised

| Scope                                            | Source                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| pass + step-by-step gherkin                      | `Scenario: User adds an item to the cart`             |
| fail (assertion in step def)                     | `Scenario: User cannot check out an empty cart`       |
| Severity tag (`@blocker`, `@critical`)           | scenario tags drive `case.severity`                   |
| Free-form tags become `case.tags[]`              | `@smoke`, `@regression`                               |
| `Scenario Outline` (parametrized)                | `Scenario Outline: Region-based pricing` (×2)         |
| `case.behavior.gherkin[]`                        | every Given/When/Then line                            |
| `case.behavior.epic`                             | feature name (`Cart`)                                 |
| Fixture `attachment` from `Scenario.attach()`    | (real Maven run only — fixture omits binary)          |

## Note on `framework.name`

The Kensho v1 schema enumerates `cucumber-js` for cucumber-family adapters.
`framework.name = "cucumber-js"` is reported by the JVM plugin; the
`framework.version` field carries the cucumber-jvm version for downstream
disambiguation. A future schema bump will split this into a dedicated
`cucumber-jvm` value.
