# KaizenReport.Kensho.MSTest

VSTest logger that emits the canonical [Kensho v1](../schema) JSON
format. Picked up automatically by `dotnet test --logger kensho` once
the package is installed.

## Install

```bash
dotnet add package KaizenReport.Kensho.MSTest
```

That's it — no source-level wiring. The package registers an
`ITestLoggerWithParameters` extension under the friendly name `kensho`,
so VSTest discovers it during test discovery.

## Run

```bash
dotnet test --logger kensho
# => kensho-results/run.json + kensho-results/cases/*.json

# Or with parameters:
dotnet test --logger 'kensho;ProjectName=Cart Service;ProjectSlug=cart-service'

npx kensho generate
npx kensho open
```

## Configuration

Logger parameters (`--logger 'kensho;Param=value;...'`) or env vars:

| Param          | Env var                | Effect                          |
| -------------- | ---------------------- | ------------------------------- |
| `Output`       | `KENSHO_OUTPUT`        | Output dir (default: `./kensho-results`) |
| `ProjectName`  | `KENSHO_PROJECT_NAME`  | Project name in `run.json`      |
| `ProjectSlug`  | `KENSHO_PROJECT_SLUG`  | Project slug                    |
| `RunId`        | `KENSHO_RUN_ID`        | Override the auto-generated run id |

## Mapping MSTest → Kensho

| MSTest                                          | Kensho                                                  |
| ----------------------------------------------- | ------------------------------------------------------- |
| `[TestMethod]`                                  | One `case`                                              |
| `[DataRow(...)]` / `[DataTestMethod]`           | One case per row, args in `case.parameters[]`           |
| `[DynamicData(...)]`                            | One case per yielded row                                |
| `[Priority(0)]`                                 | `case.severity = "blocker"`                             |
| `[Priority(1)]`                                 | `case.severity = "critical"`                            |
| `[Priority(2)]`                                 | `case.severity = "normal"`                              |
| `[Priority(3)]`                                 | `case.severity = "minor"`                               |
| `[TestProperty("severity","critical")]`         | `case.severity`                                         |
| `[Description("...")]`                          | `case.description`                                      |
| `[Owner("alice")]`                              | `case.owner`                                            |
| `[TestCategory("severity:blocker")]`            | `case.severity`                                         |
| `[TestCategory("feature:Cart")]`                | `case.behavior.feature`                                 |
| `[TestCategory("epic:Checkout")]`               | `case.behavior.epic`                                    |
| `[TestCategory("story:...")]`                   | `case.behavior.scenario`                                |
| `[TestCategory("smoke")]` (un-prefixed)         | `case.tags[]`                                           |
| `[TestProperty("Feature","Cart")]`              | `case.behavior.feature`                                 |
| `Passed`                                        | `pass`                                                  |
| `Failed`                                        | `fail`                                                  |
| `Skipped`                                       | `skip`                                                  |
| `NotFound` / `None`                             | `broken`                                                |
| `TestContext.WriteLine` / stdout / stderr       | `case.logs[]`                                           |
| `TestContext.AddResultFile(...)`                | `case.attachments[]`                                    |

## Helper API

Use the same `KaizenReport.Kensho.Core.Kensho` helpers from inside a test
to add steps / attachments / labels / links — see
[KaizenReport.Kensho.Core](../dotnet-core/README.md).

```csharp
using KaizenReport.Kensho.Core;

[TestMethod]
public void Login_redirects_to_home()
{
    using (Kensho.Step("open the login page"))
        Page.Goto("/login");

    using (Kensho.Step("submit credentials"))
    {
        Page.Fill("#user", "demo");
        Page.Click("text=Sign in");
    }

    Kensho.Label("team", "growth");
    Kensho.Link("https://jira.example.com/browse/PROJ-123",
                kind: "jira", label: "PROJ-123");
    Kensho.Attach("/tmp/login.png", kind: "screenshot");
}
```

## License

Apache-2.0.
