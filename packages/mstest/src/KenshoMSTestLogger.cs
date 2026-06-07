using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using KaizenReport.Kensho.Core;
using Microsoft.VisualStudio.TestPlatform.ObjectModel;
using Microsoft.VisualStudio.TestPlatform.ObjectModel.Client;
using Microsoft.VisualStudio.TestPlatform.ObjectModel.Logging;

namespace KaizenReport.Kensho.MSTest;

// VSTest logger plugin. Picked up by `dotnet test --logger kensho` once the
// users adds a PackageReference to KaizenReport.Kensho.MSTest. VSTest scans
// referenced assemblies for [ExtensionUri] + ITestLoggerWithParameters and
// invokes us for each test result + the run-completion event.
[ExtensionUri("logger://KaizenReport/Kensho/v1")]
[FriendlyName("kensho")]
public sealed class KenshoMSTestLogger : ITestLoggerWithParameters
{
    private KenshoWriter? _writer;
    private DateTimeOffset _runStart;
    private string? _projectName;
    private string? _projectSlug;
    private string? _outputDir;
    private string? _runId;

    public void Initialize(TestLoggerEvents events, string testRunDirectory)
    {
        InitializeCommon(events, parameters: null, fallbackOutput: testRunDirectory);
    }

    public void Initialize(TestLoggerEvents events, Dictionary<string, string?> parameters)
    {
        InitializeCommon(events, parameters, fallbackOutput: null);
    }

    private void InitializeCommon(TestLoggerEvents events, Dictionary<string, string?>? parameters, string? fallbackOutput)
    {
        if (events == null) throw new ArgumentNullException(nameof(events));

        _outputDir = ParamOrEnv(parameters, "Output", "KENSHO_OUTPUT") ?? "kensho-results";
        _projectName = ParamOrEnv(parameters, "ProjectName", "KENSHO_PROJECT_NAME") ?? "Unknown project";
        _projectSlug = ParamOrEnv(parameters, "ProjectSlug", "KENSHO_PROJECT_SLUG") ?? Slugify(_projectName);
        _runId = ParamOrEnv(parameters, "RunId", "KENSHO_RUN_ID")
                 ?? "run_" + DateTimeOffset.UtcNow.ToString("yyyyMMddHHmmss");

        _runStart = DateTimeOffset.UtcNow;

        events.TestResult += OnTestResult;
        events.TestRunComplete += OnRunComplete;
    }

    private void EnsureWriter()
    {
        if (_writer != null) return;
        _writer = new KenshoWriter(
            outputDir: _outputDir ?? "kensho-results",
            project: new KenshoProject { Name = _projectName ?? "Unknown project", Slug = _projectSlug ?? "unknown" },
            framework: new KenshoFramework
            {
                Name = "mstest",
                Version = typeof(TestResult).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            },
            runId: _runId ?? "run_unknown");
    }

    private void OnTestResult(object? sender, TestResultEventArgs e)
    {
        try
        {
            EnsureWriter();
            var c = ToKenshoCase(e.Result);
            _writer!.AddCase(c);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[kensho] OnTestResult failed: {ex.Message}");
        }
    }

    private void OnRunComplete(object? sender, TestRunCompleteEventArgs e)
    {
        try
        {
            EnsureWriter();
            _writer!.Finish();
            Console.WriteLine($"[kensho] wrote run.json + cases/ to {_writer!.OutputDir}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[kensho] OnRunComplete failed: {ex.Message}");
        }
    }

    private KenshoCase ToKenshoCase(TestResult r)
    {
        var tc = r.TestCase;
        var fullName = tc.FullyQualifiedName ?? tc.DisplayName ?? "unnamed";
        var name = tc.DisplayName ?? ShortName(fullName);
        var (suite, _) = SplitFqn(fullName);
        var filePath = NormalizePath(tc.CodeFilePath);

        var caseId = _writer!.ResolveId(fullName, filePath);
        var startedAt = r.StartTime == default ? _runStart : r.StartTime.ToUniversalTime();
        var duration = (long)Math.Max(0, r.Duration.TotalMilliseconds);

        var c = new KenshoCase
        {
            Id = caseId,
            Name = name,
            FullName = fullName,
            FilePath = filePath,
            Line = tc.LineNumber > 0 ? tc.LineNumber : (int?)null,
            Suite = suite.Count > 0 ? suite : null,
            Status = MapStatus(r.Outcome),
            StartedAt = startedAt.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            FinishedAt = startedAt.AddMilliseconds(duration).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            Duration = duration,
            Retries = 0,
            Platform = NormalizePlatform(),
        };

        ApplyTraitsAndProperties(c, tc);
        ApplyDataRowParameters(c, r);

        if (c.Status == "fail" || c.Status == "broken")
        {
            var msg = r.ErrorMessage;
            var stack = r.ErrorStackTrace;
            if (!string.IsNullOrEmpty(msg) || !string.IsNullOrEmpty(stack))
            {
                c.Errors = new List<KenshoError>
                {
                    new()
                    {
                        Message = string.IsNullOrEmpty(msg) ? "test failed" : msg!.Split('\n')[0],
                        Stack = stack,
                    },
                };
            }
        }

        // Stdout / stderr captured as test messages.
        if (r.Messages != null)
        {
            foreach (var m in r.Messages)
            {
                if (string.IsNullOrEmpty(m?.Text)) continue;
                c.Logs ??= new List<KenshoLog>();
                foreach (var line in m.Text!.Split('\n'))
                {
                    var trimmed = line.TrimEnd('\r');
                    if (string.IsNullOrEmpty(trimmed)) continue;
                    c.Logs.Add(new KenshoLog { T = 0, Level = MapMessageLevel(m.Category), Msg = trimmed });
                }
            }
        }

        // Attachments — VSTest carries them as TestResult.Attachments referencing
        // file URIs. We copy them into kensho-results/attachments/<caseId>/.
        if (r.Attachments != null)
        {
            var copier = _writer!.CreateCopier();
            var scratch = new CaseScratch(caseId, fullName, startedAt.ToUnixTimeMilliseconds());
            foreach (var set in r.Attachments)
            {
                if (set.Attachments == null) continue;
                foreach (var a in set.Attachments)
                {
                    var uri = a.Uri?.LocalPath;
                    if (string.IsNullOrEmpty(uri) || !File.Exists(uri)) continue;
                    var att = copier(scratch, uri!, kind: null, name: null, mimeType: null);
                    if (att == null) continue;
                    c.Attachments ??= new List<KenshoAttachment>();
                    c.Attachments.Add(att);
                }
            }
        }

        return c;
    }

    private static void ApplyTraitsAndProperties(KenshoCase c, TestCase tc)
    {
        var tags = new List<string>();
        // Traits — VSTest exposes [TestCategory] and [TestProperty] as Traits.
        if (tc.Traits != null)
        {
            foreach (var t in tc.Traits)
            {
                var name = t.Name ?? string.Empty;
                var val = t.Value ?? string.Empty;
                if (string.Equals(name, "TestCategory", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(name, "Category", StringComparison.OrdinalIgnoreCase))
                {
                    if (TryConsumePrefixed(val, "severity:", out var sev)) { c.Severity ??= NormalizeSeverity(sev); continue; }
                    if (TryConsumePrefixed(val, "feature:", out var ft)) { (c.Behavior ??= new KenshoBehavior()).Feature ??= ft; continue; }
                    if (TryConsumePrefixed(val, "epic:", out var ep)) { (c.Behavior ??= new KenshoBehavior()).Epic ??= ep; continue; }
                    if (TryConsumePrefixed(val, "story:", out var st)) { (c.Behavior ??= new KenshoBehavior()).Scenario ??= st; continue; }
                    tags.Add(val);
                    continue;
                }

                switch (name.ToLowerInvariant())
                {
                    case "severity": c.Severity ??= NormalizeSeverity(val); break;
                    case "priority":
                        c.Severity ??= MapPriority(val);
                        break;
                    case "feature": (c.Behavior ??= new KenshoBehavior()).Feature ??= val; break;
                    case "epic": (c.Behavior ??= new KenshoBehavior()).Epic ??= val; break;
                    case "story": (c.Behavior ??= new KenshoBehavior()).Scenario ??= val; break;
                    case "owner": c.Owner ??= val; break;
                    case "description": c.Description ??= val; break;
                    default:
                        // Free-form trait => label.
                        c.Labels ??= new Dictionary<string, string>();
                        if (!c.Labels.ContainsKey(name)) c.Labels[name] = val;
                        break;
                }
            }
        }

        // [Priority(0..3)] surfaces on the TestCase as a Property with name
        // "MSTestDiscoverer.TestPriority" — read it for severity mapping.
        if (c.Severity == null)
        {
            foreach (var prop in tc.Properties)
            {
                if (prop.Id?.IndexOf("Priority", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    var raw = tc.GetPropertyValue(prop)?.ToString();
                    if (!string.IsNullOrEmpty(raw))
                    {
                        c.Severity = MapPriority(raw!);
                        if (c.Severity != null) break;
                    }
                }
            }
        }

        if (tags.Count > 0) c.Tags = tags;
    }

    private static void ApplyDataRowParameters(KenshoCase c, TestResult r)
    {
        // MSTest pushes [DataRow] / DynamicData iteration values into the
        // DisplayName as "Method (a,b,c)". Try to round-trip them as
        // parameters when present.
        var dn = r.DisplayName ?? r.TestCase.DisplayName ?? string.Empty;
        var open = dn.IndexOf('(');
        var close = dn.LastIndexOf(')');
        if (open > 0 && close > open + 1)
        {
            var args = dn.Substring(open + 1, close - open - 1);
            var parts = SplitArgs(args);
            if (parts.Count > 0)
            {
                c.Parameters = new List<KenshoParameter>();
                for (var i = 0; i < parts.Count; i++)
                {
                    c.Parameters.Add(new KenshoParameter
                    {
                        Name = $"arg{i}",
                        Value = parts[i],
                        Kind = "argument",
                    });
                }
            }
        }
    }

    private static List<string> SplitArgs(string s)
    {
        var results = new List<string>();
        var depth = 0;
        var start = 0;
        var inStr = false;
        for (var i = 0; i < s.Length; i++)
        {
            var ch = s[i];
            if (ch == '"' && (i == 0 || s[i - 1] != '\\')) inStr = !inStr;
            else if (!inStr && (ch == '(' || ch == '[' || ch == '{')) depth++;
            else if (!inStr && (ch == ')' || ch == ']' || ch == '}')) depth--;
            else if (!inStr && depth == 0 && ch == ',')
            {
                results.Add(s.Substring(start, i - start).Trim());
                start = i + 1;
            }
        }
        if (start < s.Length) results.Add(s.Substring(start).Trim());
        return results.Where(p => p.Length > 0).ToList();
    }

    private static string MapStatus(TestOutcome outcome) => outcome switch
    {
        TestOutcome.Passed => "pass",
        TestOutcome.Failed => "fail",
        TestOutcome.Skipped => "skip",
        TestOutcome.NotFound => "broken",
        TestOutcome.None => "broken",
        _ => "broken",
    };

    private static string? MapPriority(string raw)
    {
        if (!int.TryParse(raw, out var n)) return null;
        return n switch
        {
            0 => "blocker",
            1 => "critical",
            2 => "normal",
            3 => "minor",
            _ => "trivial",
        };
    }

    private static string MapMessageLevel(string? category) => (category ?? string.Empty).ToLowerInvariant() switch
    {
        "stderr" => "warn",
        "error" => "error",
        "warning" => "warn",
        "debug" => "debug",
        _ => "info",
    };

    private static string? NormalizeSeverity(string v)
    {
        var lo = (v ?? string.Empty).Trim().ToLowerInvariant();
        return Array.IndexOf(KenshoSchema.Severity, lo) >= 0 ? lo : null;
    }

    private static (List<string> suite, string name) SplitFqn(string fqn)
    {
        var parts = fqn.Split('.');
        if (parts.Length <= 1) return (new List<string>(), fqn);
        var name = parts[parts.Length - 1];
        var suite = parts.Take(parts.Length - 1).ToList();
        return (suite, name);
    }

    private static string ShortName(string fqn)
    {
        var dot = fqn.LastIndexOf('.');
        return dot > 0 && dot + 1 < fqn.Length ? fqn.Substring(dot + 1) : fqn;
    }

    private static string? NormalizePath(string? p)
    {
        if (string.IsNullOrEmpty(p)) return null;
        var cwd = Directory.GetCurrentDirectory();
        try
        {
            var rootUri = new Uri(cwd.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar);
            var pathUri = new Uri(p!);
            var rel = Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString());
            return rel.Replace('\\', '/');
        }
        catch
        {
            return p!.Replace('\\', '/');
        }
    }

    private static string NormalizePlatform()
    {
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Linux)) return "linux";
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.OSX)) return "darwin";
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows)) return "win32";
        return "unknown";
    }

    private static bool TryConsumePrefixed(string s, string prefix, out string value)
    {
        if (!string.IsNullOrEmpty(s) && s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = s.Substring(prefix.Length).Trim();
            return value.Length > 0;
        }
        value = string.Empty;
        return false;
    }

    private static string? ParamOrEnv(Dictionary<string, string?>? parameters, string paramName, string envName)
    {
        if (parameters != null && parameters.TryGetValue(paramName, out var v) && !string.IsNullOrEmpty(v)) return v;
        var ev = Environment.GetEnvironmentVariable(envName);
        return string.IsNullOrEmpty(ev) ? null : ev;
    }

    private static string Slugify(string name)
    {
        var s = (name ?? string.Empty).ToLowerInvariant().Trim();
        var chars = s.Select(c => char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '-').ToArray();
        var slug = new string(chars).Trim('-');
        return string.IsNullOrEmpty(slug) ? "unknown" : slug;
    }
}
