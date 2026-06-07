# kensho-junit5

A JUnit 5 (Jupiter) reporter that emits the canonical [Kensho v1](../schema)
JSON format. Drop the dependency on your test classpath, run `mvn test`, point
the `kensho` CLI at `kensho-results/`, get a self-contained static HTML report.

## Install

Maven:

```xml
<dependency>
  <groupId>com.kaizenreport</groupId>
  <artifactId>kensho-junit5</artifactId>
  <version>0.1.0</version>
  <scope>test</scope>
</dependency>
```

Gradle (Kotlin DSL):

```kotlin
testImplementation("com.kaizenreport:kensho-junit5:0.1.0")
```

The listener auto-registers via JUnit Platform's
`META-INF/services/org.junit.platform.launcher.TestExecutionListener` SPI — no
test-runner config required. JDK 11+ is the baseline.

## Run

```bash
mvn test
# => kensho-results/run.json + kensho-results/cases/*.json + kensho-results/attachments/

npx kensho generate
npx kensho open
```

## Configuration

System properties (and matching env vars) override defaults:

| Property                | Env var                  | Default            |
| ----------------------- | ------------------------ | ------------------ |
| `kensho.output`         | `KENSHO_OUTPUT`          | `./kensho-results` |
| `kensho.project.name`   | `KENSHO_PROJECT_NAME`    | `Unknown project`  |
| `kensho.project.slug`   | `KENSHO_PROJECT_SLUG`    | _slug of the name_ |
| `kensho.project.url`    | `KENSHO_PROJECT_URL`     | _none_             |
| `kensho.run.id`         | `KENSHO_RUN_ID`          | _auto-generated_   |

Pass the same `KR_AUTHOR`, `KR_COMMIT_MSG`, `KR_STAGE`, `KR_BASE_URL`,
`KR_APP_VERSION`, `KR_BUILD_NUMBER`, `KR_RELEASE`, `KR_REGION`, `KR_LOCALE`,
`KR_TRIGGER`, `KR_FEATURE` env vars as the JS / pytest adapters and they show
up on `run.env`.

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <configuration>
    <systemPropertyVariables>
      <kensho.project.name>Cart Service</kensho.project.name>
      <kensho.project.slug>cart-service</kensho.project.slug>
    </systemPropertyVariables>
  </configuration>
</plugin>
```

## What it produces

- `kensho-results/run.json` — manifest (project, env, totals, framework, timing).
- `kensho-results/cases/<stableId>.json` — one file per test case.
- `kensho-results/attachments/<caseId>/...` — files registered via `Kensho.attach`.

Each case's `id` is the same `tc_<16-hex>` FNV-1a hash the JS / pytest adapters
use, so the same test correlates across runs and across languages on the
KaizenReport platform.

## Annotations we read

| Annotation                                    | Effect                                                 |
| --------------------------------------------- | ------------------------------------------------------ |
| `@Severity("critical")`                       | Sets `case.severity`. Allowed: `blocker`, `critical`, `normal`, `minor`, `trivial`. |
| `@Blocker` / `@Critical` / `@Normal` / `@Minor` / `@Trivial` | Shorthand alias for the above. |
| `@Epic("Checkout")`                           | Sets `case.behavior.epic`.                             |
| `@Feature("Cart")`                            | Sets `case.behavior.feature`.                          |
| `@Story("Empty cart shows CTA")`              | Sets `case.behavior.scenario`.                         |
| `@Description("Long-form…")`                  | Sets `case.description`.                               |
| `@Owner("alice")`                             | Sets `case.owner`.                                     |
| `@Label(key="team", value="cart")`            | Adds free-form `key=value` to `case.labels`. Repeatable. |
| `@Link(url="https://…", kind="jira", label="PROJ-123")` | Adds an entry to `case.links`. Repeatable. |
| `@Tag("smoke")` (built-in JUnit)              | Becomes a `case.tags[]` entry.                         |
| `@DisplayName("login: happy path")` (built-in) | Becomes `case.name`. Inline `@tag` syntax is also captured. |
| `@ParameterizedTest` (built-in)               | Each invocation's display name is captured as `case.parameters[].displayName`. |

Class-level annotations apply to every test in the class; method annotations
take precedence.

## Helper API — `com.kaizenreport.kensho.Kensho`

All methods are no-ops outside an active test, so you can sprinkle them into
shared utility code without crashing non-test runs.

```java
import com.kaizenreport.kensho.Kensho;
import org.junit.jupiter.api.Test;

class LoginTest {
  @Test
  void happyPath() {
    try (var s = Kensho.step("open the login page")) {
      page.goto("/login");
    }
    try (var s = Kensho.step("submit credentials")) {
      page.fill("#user", "demo");
      page.click("text=Sign in");
      try (var nested = Kensho.step("verify redirect")) {
        assert page.url().endsWith("/home");
      }
    }
    Kensho.label("team", "growth");
    Kensho.link("https://jira.example.com/browse/PROJ-123", "jira", "PROJ-123");
    page.screenshot(Path.of("/tmp/login.png"));
    Kensho.attach(Path.of("/tmp/login.png"), "screenshot");
  }
}
```

| Helper                                              | What it does                                                    |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `Kensho.step(title)` / `Kensho.step(title, action)` | Returns an `AutoCloseable` step. Nests automatically. On uncaught exception inside the block the step is marked `fail` and the exception re-thrown. |
| `Kensho.attach(path, kind)`                         | Copies the file into `kensho-results/attachments/<caseId>/` and registers it on the current case (or on the innermost open step). |
| `Kensho.label(key, value)`                          | Adds a string label to the case.                                |
| `Kensho.link(url, kind, label)`                     | Adds a hyperlink to the case.                                   |
| `Kensho.currentCaseId()`                            | Returns the stable case id, or `null` outside a test.           |

## Status mapping

| JUnit `TestExecutionResult`         | Kensho `case.status` |
| ----------------------------------- | -------------------- |
| `SUCCESSFUL`                        | `pass`               |
| `FAILED`                            | `fail`               |
| `ABORTED` (e.g. `Assumptions.assumeTrue` failure) | `broken`  |
| `executionSkipped` (skip-by-condition) | `skip`            |

## Errors

A `Throwable` from the test method becomes a single
`case.errors[]` entry: `message` is the first line, `stack` is the full
exception chain, `type` is the FQCN of the throwable.

## License

Apache-2.0.
