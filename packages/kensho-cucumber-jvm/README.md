# kensho-cucumber-jvm

A Cucumber-JVM 7.x plugin that emits the canonical [Kensho v1](../schema) JSON
format. Drop the dependency on your test classpath, run your scenarios, point
the `kensho` CLI at `kensho-results/`.

## Install

Maven:

```xml
<dependency>
  <groupId>com.kaizenreport</groupId>
  <artifactId>kensho-cucumber-jvm</artifactId>
  <version>0.1.0</version>
  <scope>test</scope>
</dependency>
```

Gradle:

```kotlin
testImplementation("com.kaizenreport:kensho-cucumber-jvm:0.1.0")
```

The plugin auto-registers via Cucumber's
`META-INF/services/io.cucumber.plugin.Plugin` SPI — no `@CucumberOptions(plugin
= …)` line needed. The plugin implements `ConcurrentEventListener`, so it
works under parallel scenario execution.

JDK 11+ baseline. Cucumber 7.x.

## Run

```bash
mvn test
# => kensho-results/run.json + kensho-results/cases/*.json + kensho-results/attachments/

npx kensho generate
npx kensho open
```

If you want to opt-in explicitly (e.g. on Cucumber < 7.20 where SPI auto-load
isn't reliable):

```java
@CucumberOptions(plugin = "com.kaizenreport.kensho.cucumber.KenshoCucumberPlugin")
public class RunCucumberTest { /* ... */ }
```

## Configuration

Same system properties / env vars as the other JVM adapters:

| Property                | Env var                  | Default            |
| ----------------------- | ------------------------ | ------------------ |
| `kensho.output`         | `KENSHO_OUTPUT`          | `./kensho-results` |
| `kensho.project.name`   | `KENSHO_PROJECT_NAME`    | `Unknown project`  |
| `kensho.project.slug`   | `KENSHO_PROJECT_SLUG`    | _slug of the name_ |
| `kensho.run.id`         | `KENSHO_RUN_ID`          | _auto-generated_   |

Plus the standard `KR_*` variables for CI metadata (see
`kensho-junit5/README.md`).

## What it emits

| Cucumber concept                                   | Kensho field                                   |
| -------------------------------------------------- | ---------------------------------------------- |
| Feature                                            | `case.behavior.epic`, `case.behavior.feature`, `case.suite[0]` |
| Scenario                                           | One Kensho case (`case.name = scenario name`)  |
| Step (`Given/When/Then`)                           | One Kensho step (`step.title = "Given …"`)     |
| Step `DataTable`                                   | `step.parameters[]` (`kind: "data-row"`)       |
| Hook (`@Before` / `@After`) — only when failing    | `step.phase = "setup"` step                    |
| Scenario tag (`@smoke`)                            | `case.tags[]`                                  |
| Severity tag (`@blocker` / `@critical` / etc.)     | `case.severity`                                |
| `Scenario.attach(bytes, mime, name)`               | `case.attachments[]` (file written under `attachments/<caseId>/`) |
| `Scenario.write(text)`                             | `case.logs[]` entry                            |
| Gherkin step text                                  | `case.behavior.gherkin[]`                      |

## Status mapping

| Cucumber `Status`                | Kensho `case.status` |
| -------------------------------- | -------------------- |
| `PASSED`                         | `pass`               |
| `FAILED`                         | `fail`               |
| `SKIPPED` / `PENDING`            | `skip`               |
| `UNDEFINED` / `AMBIGUOUS` / `UNUSED` | `broken`         |

## Helper API — `com.kaizenreport.kensho.Kensho`

Identical to the other JVM adapters. Most cucumber tests don't need it — your
step definitions get nice steps "for free" — but it's available if a step
needs to add a label, link, or extra attachment beyond what
`Scenario.attach()` covers.

## Note on `framework.name`

The Kensho v1 schema enumerates `cucumber-js` for cucumber-family adapters.
`framework.name = "cucumber-js"` is reported here so the run validates
against the unmodified schema; `framework.version` carries the cucumber-jvm
version for downstream disambiguation. A future schema bump can split this
into a dedicated `cucumber-jvm` value.

## License

Apache-2.0.
