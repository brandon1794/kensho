# KaizenReport.Kensho.Xunit

xUnit hook that emits the canonical [Kensho v1](../schema) JSON format.

xUnit doesn't ship a logger SPI like NUnit's `ITestEventListener` or
VSTest's `ITestLogger`, so this adapter uses xUnit's
`BeforeAfterTestAttribute` extensibility point. Apply the attribute at
the assembly level (or inherit `KenshoTestBase`) and the writer takes
care of the rest.

## Install

```bash
dotnet add package KaizenReport.Kensho.Xunit
```

Wire it up by adding one line:

```csharp
[assembly: KaizenReport.Kensho.Xunit.KenshoTracked]
```

Or extend the helper base class:

```csharp
public class CartTests : KaizenReport.Kensho.Xunit.KenshoTestBase
{
    [Fact]
    public void Adds_first_item() { /* ... */ }
}
```

## Run

```bash
dotnet test
# => kensho-results/run.json + kensho-results/cases/*.json

npx kensho generate
npx kensho open
```

## Configuration

Environment variables:

| Env var                  | Effect                                                |
| ------------------------ | ----------------------------------------------------- |
| `KENSHO_OUTPUT`          | Output dir (default: `./kensho-results`)              |
| `KENSHO_PROJECT_NAME`    | Project name in `run.json`                            |
| `KENSHO_PROJECT_SLUG`    | Project slug                                          |
| `KENSHO_RUN_ID`          | Override the auto-generated run id                    |

## Mapping xUnit → Kensho

| xUnit                                                | Kensho                                                  |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `[Fact]` / `[Theory]`                                | One `case`                                              |
| `[InlineData(...)]` / `[MemberData(...)]` / `[ClassData(...)]` | One case per row, args round-tripped from the display name into `case.parameters[]` |
| `[Trait("severity","blocker")]`                      | `case.severity = "blocker"`                             |
| `[Trait("feature","Cart")]`                          | `case.behavior.feature`                                 |
| `[Trait("epic","Checkout")]`                         | `case.behavior.epic`                                    |
| `[Trait("story","...")]`                             | `case.behavior.scenario`                                |
| `[Trait("owner","alice")]`                           | `case.owner`                                            |
| `[Trait("description","...")]`                       | `case.description`                                      |
| `[Trait("tag","smoke")]` / `[Trait("category","x")]` | `case.tags[]`                                           |
| Other `[Trait("k","v")]`                             | `case.labels["k"] = "v"`                                |
| Test passed                                          | `pass`                                                  |
| Test failed                                          | `fail` (see "Outcome detection" below)                  |
| Test skipped                                         | `skip`                                                  |

## Outcome detection — known limitation

xUnit's `BeforeAfterTestAttribute` does **not** receive the test outcome
in `After()`. The pragmatic workaround:

1. The helper API still works — `using (Kensho.Step("..."))` blocks that
   throw will be marked `fail`, and the case status reflects them.
2. For assertion failures outside of a step, wrap the assertion in a
   `Kensho.Step("assert ...")` block. xUnit's exception will close the
   step as `fail`, which the writer reads as a failed case.
3. Alternatively, install the framework name as `junit-xml` (the
   default) and add a small post-run xUnit logger pass — outside the
   scope of this adapter.

Because the xUnit name is not in the Kensho v1 framework enum, the
adapter writes `framework.name = "junit-xml"`. Bumping the schema to
add `xunit` is a `v2` concern.

## Helper API

```csharp
using KaizenReport.Kensho.Core;
using Xunit;

public class LoginTests : KaizenReport.Kensho.Xunit.KenshoTestBase
{
    [Fact]
    public void Redirects_to_home_after_signin()
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
}
```

## License

Apache-2.0.
