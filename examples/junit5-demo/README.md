# junit5-demo

End-to-end demo for `@kaizenreport/kensho-junit5`: a tiny Maven project that
exercises pass / fail / skip / broken statuses, parameterized tests, severity
+ behavior annotations, attachments, and `Kensho.step` blocks.

## Run with Maven (real JVM)

```bash
mvn test
node ../../packages/cli/bin/kensho.js validate kensho-results
node ../../packages/cli/bin/kensho.js generate --input kensho-results --output kensho-report
node ../../packages/cli/bin/kensho.js open --report kensho-report
```

## Run without Maven

This folder ships a checked-in `fixtures/kensho-results/` so the rest of the
toolchain (`validate`, `generate`, `open`) can be exercised on machines
without a JVM. The fixture has the exact shape `kensho-junit5` writes when
running this demo's tests. (The repo's top-level `.gitignore` excludes
`kensho-results/` from check-in, hence the `fixtures/` indirection.)

```bash
node ../../packages/cli/bin/kensho.js validate fixtures/kensho-results
node ../../packages/cli/bin/kensho.js generate --input fixtures/kensho-results --output kensho-report
```

## What's exercised

| Scope                            | Test                                                |
| -------------------------------- | --------------------------------------------------- |
| pass + nested `Kensho.step`      | `LoginTest.happyPath`                               |
| fail with a clear assertion msg  | `LoginTest.invalidPassword`                         |
| skip (`@Disabled`)               | `LoginTest.skippedFeature`                          |
| broken (`assumeTrue(false)`)     | `LoginTest.brokenSetup`                             |
| parameterized + severity         | `MathTest.adds`                                     |
| `@Severity` + shorthand aliases  | `LoginTest.happyPath` (`@Critical`), `LoginTest.invalidPassword` (`@Severity("blocker")`) |
| `@Epic` / `@Feature` / `@Story`  | `LoginTest`                                         |
| `@Tag` → `case.tags[]`           | `LoginTest.happyPath` carries `smoke`               |
| `@Owner` / `@Description`        | `LoginTest.happyPath`, `LoginTest.brokenSetup`      |
| `@Link` annotation               | `LoginTest.happyPath` (Jira PROJ-123)               |
| `Kensho.label` + `Kensho.link`   | `LoginTest.happyPath`                               |
| `Kensho.attach` (screenshot)     | `LoginTest.happyPath`                               |
