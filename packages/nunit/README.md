# KaizenReport.Kensho.NUnit

NUnit listener that emits the canonical [Kensho v1](../schema) JSON
format. Run your tests, then point the `kensho` CLI at `kensho-results/`
to get a self-contained static HTML report.

## Install

```bash
dotnet add package KaizenReport.Kensho.NUnit
```

Add a single line of wiring in any `.cs` file in the test project:

```csharp
[assembly: KaizenReport.Kensho.NUnit.KenshoListener(
    ProjectName = "Cart Service",
    ProjectSlug = "cart-service")]
```

The listener is an NUnit `ITestAction` attribute applied at the assembly
level, so it fires `BeforeTest` / `AfterTest` for every test in the
assembly — no `conftest.py`-style file required.

## Run

```bash
dotnet test
# => kensho-results/run.json + kensho-results/cases/*.json

npx kensho generate
npx kensho open
```

## Configuration

Either via the attribute properties (`OutputDir`, `ProjectName`,
`ProjectSlug`, `RunId`) or via environment variables:

| Env var                  | Effect                                                |
| ------------------------ | ----------------------------------------------------- |
| `KENSHO_OUTPUT`          | Output dir (default: `./kensho-results`)              |
| `KENSHO_PROJECT_NAME`    | Project name in `run.json`                            |
| `KENSHO_PROJECT_SLUG`    | Project slug                                          |
| `KENSHO_RUN_ID`          | Override the auto-generated run id                    |

## Mapping NUnit → Kensho

| NUnit                                         | Kensho                                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| `[Test]`, `[TestCase(...)]`                   | One `case` per test, parameters in `case.parameters[]`     |
| `[TestCaseSource(...)]`                       | One case per source row                                    |
| `[Description("...")]`                        | `case.description`                                         |
| `[Author("alice")]`                           | `case.owner`                                               |
| `[Category("severity:blocker")]`              | `case.severity = "blocker"`                                |
| `[Category("feature:Cart")]`                  | `case.behavior.feature = "Cart"`                           |
| `[Category("epic:Checkout")]`                 | `case.behavior.epic`                                       |
| `[Category("story:...")]`                     | `case.behavior.scenario`                                   |
| `[Category("smoke")]` (un-prefixed)           | `case.tags[]`                                              |
| `[Property("Severity","critical")]`           | `case.severity`                                            |
| `[Property("Feature","Cart")]`                | `case.behavior.feature`                                    |
| `[Property("Epic","Checkout")]`               | `case.behavior.epic`                                       |
| `[Property("Story","...")]`                   | `case.behavior.scenario`                                   |
| `[Property("Owner","alice")]`                 | `case.owner`                                               |
| `Passed`                                      | `pass`                                                     |
| `Failed`                                      | `fail`                                                     |
| `Skipped` / `Ignored`                         | `skip`                                                     |
| `Inconclusive` / `Warning`                    | `broken`                                                   |
| `TestContext.WriteLine` / stdout              | `case.logs[]`                                              |
| `TestContext.AddTestAttachment(...)`          | Picked up by `Kensho.Attach` when called from test code    |

## Helper API

```csharp
using KaizenReport.Kensho.Core;

[Test]
public async Task Login_redirects_to_home()
{
    using (Kensho.Step("open the login page"))
        await Page.GotoAsync("/login");

    using (Kensho.Step("submit credentials"))
    {
        await Page.FillAsync("#user", "demo");
        await Page.ClickAsync("text=Sign in");
    }

    Kensho.Label("team", "growth");
    Kensho.Link("https://jira.example.com/browse/PROJ-123",
                kind: "jira", label: "PROJ-123");
    Kensho.Attach("/tmp/login.png", kind: "screenshot");
}
```

All four helpers are no-ops outside a running test, so it's safe to call
them from shared utility code.

## License

Apache-2.0.
