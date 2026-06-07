# kensho-testng

A TestNG reporter that emits the canonical [Kensho v1](../schema) JSON format.
Drop the dependency on your test classpath, run `mvn test`, point the `kensho`
CLI at `kensho-results/`, get a self-contained static HTML report.

## Install

Maven:

```xml
<dependency>
  <groupId>com.kaizenreport</groupId>
  <artifactId>kensho-testng</artifactId>
  <version>0.1.0</version>
  <scope>test</scope>
</dependency>
```

Gradle:

```kotlin
testImplementation("com.kaizenreport:kensho-testng:0.1.0")
```

The listener auto-registers via TestNG's
`META-INF/services/org.testng.ITestNGListener` SPI — no `<listeners>` block
needed in `testng.xml`. JDK 11+ baseline.

## Run

```bash
mvn test
# => kensho-results/run.json + kensho-results/cases/*.json + kensho-results/attachments/

npx kensho generate
npx kensho open
```

## Configuration

Same system properties / env vars as `kensho-junit5`:

| Property                | Env var                  | Default            |
| ----------------------- | ------------------------ | ------------------ |
| `kensho.output`         | `KENSHO_OUTPUT`          | `./kensho-results` |
| `kensho.project.name`   | `KENSHO_PROJECT_NAME`    | `<TestNG suite name>` |
| `kensho.project.slug`   | `KENSHO_PROJECT_SLUG`    | _slug of the name_ |
| `kensho.project.url`    | `KENSHO_PROJECT_URL`     | _none_             |
| `kensho.run.id`         | `KENSHO_RUN_ID`          | _auto-generated_   |

Plus the standard `KR_AUTHOR`, `KR_COMMIT_MSG`, `KR_STAGE`, `KR_BASE_URL`,
`KR_APP_VERSION`, `KR_BUILD_NUMBER`, `KR_RELEASE`, `KR_REGION`, `KR_LOCALE`,
`KR_TRIGGER`, `KR_FEATURE` env vars.

## Annotations we read

The same Kensho annotations as `kensho-junit5` (re-exported under
`com.kaizenreport.kensho.annotations.*`):

| Annotation                                    | Effect                                                 |
| --------------------------------------------- | ------------------------------------------------------ |
| `@Severity("critical")`                       | Sets `case.severity`. |
| `@Blocker` / `@Critical` / `@Normal` / `@Minor` / `@Trivial` | Shorthand alias. |
| `@Epic("Checkout")`                           | Sets `case.behavior.epic`.                             |
| `@Feature("Cart")`                            | Sets `case.behavior.feature`.                          |
| `@Story("Empty cart shows CTA")`              | Sets `case.behavior.scenario`.                         |
| `@Description("Long-form…")`                  | Sets `case.description`.                               |
| `@Owner("alice")`                             | Sets `case.owner`.                                     |
| `@Label(key="team", value="cart")`            | Adds free-form `key=value` to `case.labels`. Repeatable. |
| `@Link(url="https://…", kind="jira", label="PROJ-123")` | Adds a `case.links[]` entry. Repeatable. |

### TestNG `@Test(groups=…)`

TestNG's group convention is widely used for severity tagging — `@Test(groups
= {"smoke", "blocker"})`. We honour it:

* Group names that match a Kensho severity (`blocker`, `critical`, `normal`,
  `minor`, `trivial`) populate `case.severity`. They do **not** also become
  tags — that would be redundant. The explicit `@Severity` annotation still
  wins if both are present.
* All other group names become `case.tags[]` entries.

### `@DataProvider`-driven tests

Each invocation gets a separate Kensho case. Argument values are captured into
`case.parameters[]` as `arg0`, `arg1`, … `argN` (TestNG doesn't expose
parameter names through reflection at the listener boundary, so positional
labels are the most accurate option).

## Helper API — `com.kaizenreport.kensho.Kensho`

Identical to `kensho-junit5`. See that README for examples.

## Status mapping

| TestNG `ITestResult` outcome                 | Kensho `case.status` |
| -------------------------------------------- | -------------------- |
| `SUCCESS`                                    | `pass`               |
| `FAILURE` (incl. timeout)                    | `fail`               |
| `SKIP`                                       | `skip`               |
| `SUCCESS_PERCENTAGE_FAILURE`                 | `broken`             |

## License

Apache-2.0.
