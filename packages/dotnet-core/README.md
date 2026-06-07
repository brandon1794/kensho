# KaizenReport.Kensho.Core

Shared core for the Kensho .NET adapters
(`KaizenReport.Kensho.NUnit`, `KaizenReport.Kensho.MSTest`,
`KaizenReport.Kensho.Xunit`).

You don't normally consume this package directly — install the adapter for
your test framework and Core comes along as a dependency. The pieces it
exports are public so you can also drive the writer yourself if you're
building a custom reporter.

## Contents

| File                       | What's in it                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| `src/Schema.cs`            | POCOs that map one-for-one to the Kensho v1 JSON schema, with `[JsonPropertyName]` and `[JsonIgnore(WhenWritingNull)]` so the wire JSON stays clean. |
| `src/StableId.cs`          | `StableId.Compute(fullName, filePath)` — double FNV-1a hash that mirrors `stableCaseId()` in `packages/schema/index.js` byte-for-byte (UTF-16 code units, two distinct primes). Test-history correlation depends on this matching. |
| `src/EnvCapture.cs`        | `EnvCapture.Build()` — pulls CI provider, branch, commit, run URL, and `KR_*` pass-through fields. Detects GitHub Actions, GitLab CI, CircleCI, Jenkins, Buildkite, Azure Pipelines (`TF_BUILD`). |
| `src/CaseScratch.cs`       | Per-test mutable scratch (steps, attachments, logs, labels, links).  |
| `src/Kensho.cs`            | Public helper API: `Kensho.Step(...)`, `Kensho.Attach(...)`, `Kensho.Label(...)`, `Kensho.Link(...)`. Steps return `IDisposable` so `using` blocks work; everything is a no-op outside a running test. |
| `src/KenshoWriter.cs`      | Writes `kensho-results/run.json` + `cases/<id>.json` + copies attachments via `System.Text.Json`. Owns id-collision suffixing for parametrized cases. |

## Helper API

```csharp
using KaizenReport.Kensho.Core;

[Test]
public void Login_redirects_to_home()
{
    using (Kensho.Step("open the login page"))
    {
        Page.Goto("/login");
    }

    using (Kensho.Step("submit credentials"))
    {
        Page.Fill("#user", "demo");
        Page.Click("text=Sign in");
        using (Kensho.Step("verify redirect"))
        {
            Assert.That(Page.Url, Does.EndWith("/home"));
        }
    }

    Kensho.Label("team", "growth");
    Kensho.Link("https://jira.example.com/browse/PROJ-123",
                kind: "jira", label: "PROJ-123");
    Kensho.Attach("/tmp/login.png", kind: "screenshot");
}
```

## License

Apache-2.0.
