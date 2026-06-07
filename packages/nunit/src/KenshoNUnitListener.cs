using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using KaizenReport.Kensho.Core;
using NUnit.Framework;
using NUnit.Framework.Interfaces;
using KenshoApi = KaizenReport.Kensho.Core.Kensho;

namespace KaizenReport.Kensho.NUnit;

// Users wire the listener up by adding a single line in any .cs file in
// their test project:
//
//     [assembly: KaizenReport.Kensho.NUnit.KenshoListener]
//
// NUnit then fires BeforeTest / AfterTest on every test in the assembly.
// We open a CaseScratch in BeforeTest, finalize it in AfterTest, and write
// the run.json + run-level cleanup at process exit.
[AttributeUsage(AttributeTargets.Assembly, AllowMultiple = false)]
public sealed class KenshoListenerAttribute : Attribute, ITestAction
{
    public ActionTargets Targets => ActionTargets.Test;

    public string? OutputDir { get; set; }
    public string? ProjectName { get; set; }
    public string? ProjectSlug { get; set; }
    public string? RunId { get; set; }

    private static readonly Lazy<KenshoNUnitState> StateRef = new(InitState);
    private static KenshoNUnitState State => StateRef.Value;

    private static KenshoNUnitState InitState()
    {
        var output = Environment.GetEnvironmentVariable("KENSHO_OUTPUT") ?? "kensho-results";
        var name = Environment.GetEnvironmentVariable("KENSHO_PROJECT_NAME") ?? "Unknown project";
        var slug = Environment.GetEnvironmentVariable("KENSHO_PROJECT_SLUG") ?? Slugify(name);
        var runId = Environment.GetEnvironmentVariable("KENSHO_RUN_ID")
                    ?? "run_" + DateTimeOffset.UtcNow.ToString("yyyyMMddHHmmss");

        var writer = new KenshoWriter(
            outputDir: output,
            project: new KenshoProject { Name = name, Slug = slug },
            framework: new KenshoFramework
            {
                Name = "nunit",
                Version = typeof(TestAttribute).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            },
            runId: runId);

        var state = new KenshoNUnitState(writer);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => state.Flush();
        // NUnit Console / dotnet test usually finish through ProcessExit, but
        // SetUpFixtures with [OneTimeTearDown] also catch it for in-IDE runs.
        return state;
    }

    public void BeforeTest(ITest test)
    {
        try { State.OnBefore(test); }
        catch (Exception e) { Console.Error.WriteLine($"[kensho] BeforeTest failed: {e.Message}"); }
    }

    public void AfterTest(ITest test)
    {
        try { State.OnAfter(test); }
        catch (Exception e) { Console.Error.WriteLine($"[kensho] AfterTest failed: {e.Message}"); }
    }

    private static string Slugify(string name)
    {
        var s = (name ?? string.Empty).ToLowerInvariant().Trim();
        var chars = s.Select(c => char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '-').ToArray();
        var slug = new string(chars).Trim('-');
        return string.IsNullOrEmpty(slug) ? "unknown" : slug;
    }
}

internal sealed class KenshoNUnitState
{
    private readonly KenshoWriter _writer;
    private readonly Dictionary<string, long> _starts = new();
    private bool _flushed;

    public KenshoNUnitState(KenshoWriter writer)
    {
        _writer = writer;
    }

    public void OnBefore(ITest test)
    {
        if (test == null) return;
        var (fullName, name, suite, filePath) = ResolveNames(test);
        var caseId = _writer.ResolveId(fullName, filePath);
        var startMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _starts[test.Id] = startMs;

        var scratch = new CaseScratch(caseId, fullName, startMs)
        {
            Copier = _writer.CreateCopier(),
        };
        KenshoApi.SetCurrent(scratch);

        // Stash the scratch on the test's properties so we can pull it back
        // out in AfterTest in case the AsyncLocal slot is lost across the
        // teardown boundary on some runners.
        test.Properties.Set("__kensho_scratch", scratch);
        test.Properties.Set("__kensho_caseid", caseId);
        test.Properties.Set("__kensho_suite", suite);
        test.Properties.Set("__kensho_name", name);
        test.Properties.Set("__kensho_full", fullName);
        test.Properties.Set("__kensho_file", filePath ?? string.Empty);
    }

    public void OnAfter(ITest test)
    {
        if (test == null) return;
        var ctx = TestContext.CurrentContext;
        var result = ctx?.Result;

        var scratch = (CaseScratch?)test.Properties.Get("__kensho_scratch");
        var startMs = _starts.TryGetValue(test.Id, out var s) ? s : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var endMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var duration = Math.Max(0, endMs - startMs);

        var fullName = (string?)test.Properties.Get("__kensho_full") ?? test.FullName;
        var name = (string?)test.Properties.Get("__kensho_name") ?? test.Name;
        var suite = test.Properties.Get("__kensho_suite") as List<string> ?? new List<string>();
        var caseId = (string?)test.Properties.Get("__kensho_caseid")
                     ?? _writer.ResolveId(fullName ?? string.Empty, null);
        var filePath = (string?)test.Properties.Get("__kensho_file");
        if (string.IsNullOrEmpty(filePath)) filePath = null;

        var status = MapStatus(result?.Outcome);

        var c = new KenshoCase
        {
            Id = caseId,
            Name = name ?? "unnamed",
            FullName = fullName ?? name ?? "unnamed",
            FilePath = filePath,
            Suite = suite.Count > 0 ? suite : null,
            Status = status,
            StartedAt = KenshoWriter.IsoFromMs(startMs),
            FinishedAt = KenshoWriter.IsoFromMs(endMs),
            Duration = duration,
            Retries = 0,
            Platform = NormalizePlatform(),
        };

        ApplyMetadata(c, test);

        if (result != null && (status == "fail" || status == "broken"))
        {
            var msg = result.Message;
            var stack = result.StackTrace;
            if (!string.IsNullOrEmpty(msg) || !string.IsNullOrEmpty(stack))
            {
                c.Errors = new List<KenshoError>
                {
                    new()
                    {
                        Message = string.IsNullOrEmpty(msg) ? (FirstLine(stack) ?? "test failed") : msg!.Split('\n')[0],
                        Stack = stack,
                    },
                };
            }
        }

        if (scratch != null)
        {
            // Auto-close any user-opened steps that didn't dispose. Mark them
            // broken so the leak is visible in the report.
            while (scratch.StepStack.Count > 0)
            {
                var leaked = scratch.StepStack.Pop();
                leaked.Status = "broken";
            }
            if (scratch.Steps.Count > 0) c.Steps = scratch.Steps;
            if (scratch.Attachments.Count > 0) c.Attachments = scratch.Attachments;
            if (scratch.Logs.Count > 0) c.Logs = scratch.Logs;
            if (scratch.Labels.Count > 0)
            {
                c.Labels ??= new Dictionary<string, string>();
                foreach (var kv in scratch.Labels) c.Labels[kv.Key] = kv.Value;
            }
            if (scratch.Links.Count > 0)
            {
                c.Links ??= new List<KenshoLink>();
                c.Links.AddRange(scratch.Links);
            }
        }

        // Capture stdout/stderr that NUnit attached to this test result.
        var stdout = ctx?.Result?.Output;
        if (!string.IsNullOrWhiteSpace(stdout))
        {
            c.Logs ??= new List<KenshoLog>();
            foreach (var line in stdout!.Split('\n'))
            {
                var trimmed = line.TrimEnd('\r');
                if (string.IsNullOrEmpty(trimmed)) continue;
                c.Logs.Add(new KenshoLog { T = 0, Level = "info", Msg = trimmed });
            }
        }

        _writer.AddCase(c);
        KenshoApi.SetCurrent(null);
        _starts.Remove(test.Id);
    }

    public void Flush()
    {
        if (_flushed) return;
        _flushed = true;
        try { _writer.Finish(); }
        catch (Exception e) { Console.Error.WriteLine($"[kensho] failed to write run.json: {e.Message}"); }
    }

    private static (string fullName, string name, List<string> suite, string? filePath) ResolveNames(ITest test)
    {
        var name = test.Name ?? "unnamed";
        var fullName = test.FullName ?? name;
        var suite = new List<string>();

        // Walk up the parent chain to assemble the suite breadcrumb.
        var p = test.Parent;
        while (p != null && !string.IsNullOrEmpty(p.Name))
        {
            // Skip the assembly-level fixture and test-suite root.
            if (p.IsSuite && p.ClassName != null && p.Parent != null)
            {
                suite.Insert(0, p.Name);
            }
            p = p.Parent;
        }

        // NUnit doesn't directly expose the source file. We try Method.MethodInfo
        // for the declaring type's location — good enough for filePath.
        string? filePath = null;
        try
        {
            var typeFullName = test.ClassName;
            if (!string.IsNullOrEmpty(typeFullName))
            {
                var asm = test.TypeInfo?.Assembly ?? test.Method?.MethodInfo.DeclaringType?.Assembly;
                if (asm != null)
                {
                    filePath = TryRelativeFromAssembly(asm, typeFullName);
                }
            }
        }
        catch { }
        return (fullName, name, suite, filePath);
    }

    private static string? TryRelativeFromAssembly(Assembly asm, string typeFullName)
    {
        // Heuristic: project layout puts test sources beside the assembly.
        // We map "Namespace.ClassName" -> "ClassName.cs" relative to the
        // assembly directory's parent (typical bin/Debug/net*/ layout).
        try
        {
            var loc = asm.Location;
            if (string.IsNullOrEmpty(loc)) return null;
            var className = typeFullName.Split('.').Last();
            var binDir = Path.GetDirectoryName(loc);
            var projectDir = binDir;
            for (var i = 0; i < 4 && projectDir != null; i++)
            {
                var found = Directory.EnumerateFiles(projectDir, className + ".cs", SearchOption.AllDirectories)
                    .FirstOrDefault();
                if (found != null)
                {
                    var cwd = Directory.GetCurrentDirectory();
                    return MakeRelative(cwd, found).Replace('\\', '/');
                }
                projectDir = Path.GetDirectoryName(projectDir);
            }
        }
        catch { }
        return null;
    }

    private static string MapStatus(ResultState? state)
    {
        if (state == null) return "broken";
        return state.Status switch
        {
            TestStatus.Passed => "pass",
            TestStatus.Failed => "fail",
            TestStatus.Skipped => "skip",
            TestStatus.Inconclusive => "broken",
            TestStatus.Warning => "broken",
            _ => "broken",
        };
    }

    private static void ApplyMetadata(KenshoCase c, ITest test)
    {
        var props = test.Properties;
        var tags = new List<string>();

        // Description -> case.description.
        var description = props.Get(PropertyNames.Description) as string;
        if (!string.IsNullOrEmpty(description)) c.Description = description;

        // Author -> case.owner.
        var author = props.Get(PropertyNames.Author) as string;
        if (!string.IsNullOrEmpty(author)) c.Owner = author;

        // Categories — read severity:* + feature:* + epic:* + story:* prefixes.
        var categories = props[PropertyNames.Category] as System.Collections.IEnumerable;
        if (categories != null)
        {
            foreach (var cat in categories)
            {
                if (cat is not string s || string.IsNullOrEmpty(s)) continue;
                if (TryConsumePrefixed(s, "severity:", out var sev)) { c.Severity = NormalizeSeverity(sev); continue; }
                if (TryConsumePrefixed(s, "feature:", out var feat)) { (c.Behavior ??= new KenshoBehavior()).Feature = feat; continue; }
                if (TryConsumePrefixed(s, "epic:", out var ep)) { (c.Behavior ??= new KenshoBehavior()).Epic = ep; continue; }
                if (TryConsumePrefixed(s, "story:", out var st)) { (c.Behavior ??= new KenshoBehavior()).Scenario = st; continue; }
                tags.Add(s);
            }
        }

        // Custom property names we read explicitly so users can also do
        // [Property("Severity","blocker")] / [Property("Feature","Cart")].
        foreach (var key in new[] { "Severity", "severity" })
        {
            var v = props.Get(key) as string;
            if (!string.IsNullOrEmpty(v)) c.Severity ??= NormalizeSeverity(v!);
        }
        foreach (var key in new[] { "Feature", "feature" })
        {
            var v = props.Get(key) as string;
            if (!string.IsNullOrEmpty(v)) { c.Behavior ??= new KenshoBehavior(); c.Behavior.Feature ??= v; }
        }
        foreach (var key in new[] { "Epic", "epic" })
        {
            var v = props.Get(key) as string;
            if (!string.IsNullOrEmpty(v)) { c.Behavior ??= new KenshoBehavior(); c.Behavior.Epic ??= v; }
        }
        foreach (var key in new[] { "Story", "story" })
        {
            var v = props.Get(key) as string;
            if (!string.IsNullOrEmpty(v)) { c.Behavior ??= new KenshoBehavior(); c.Behavior.Scenario ??= v; }
        }
        foreach (var key in new[] { "Owner", "owner" })
        {
            var v = props.Get(key) as string;
            if (!string.IsNullOrEmpty(v)) c.Owner ??= v;
        }

        // Parameters — NUnit fills test.Arguments for [TestCase] / [TestCaseSource].
        if (test.Arguments is { Length: > 0 } args)
        {
            c.Parameters = new List<KenshoParameter>();
            for (var i = 0; i < args.Length; i++)
            {
                c.Parameters.Add(new KenshoParameter
                {
                    Name = $"arg{i}",
                    Value = args[i]?.ToString() ?? "null",
                    Kind = "argument",
                });
            }
        }

        if (tags.Count > 0) c.Tags = tags;
    }

    private static bool TryConsumePrefixed(string s, string prefix, out string value)
    {
        if (s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = s.Substring(prefix.Length).Trim();
            return value.Length > 0;
        }
        value = string.Empty;
        return false;
    }

    private static string? NormalizeSeverity(string v)
    {
        var lo = v.Trim().ToLowerInvariant();
        return Array.IndexOf(KenshoSchema.Severity, lo) >= 0 ? lo : null;
    }

    private static string NormalizePlatform()
    {
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Linux)) return "linux";
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.OSX)) return "darwin";
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows)) return "win32";
        return "unknown";
    }

    private static string MakeRelative(string root, string path)
    {
        try
        {
            var rootUri = new Uri(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar);
            var pathUri = new Uri(path);
            var rel = Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString());
            return rel.Replace('/', Path.DirectorySeparatorChar);
        }
        catch
        {
            return path;
        }
    }

    private static string? FirstLine(string? s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        foreach (var line in s!.Split('\n'))
        {
            var t = line.Trim();
            if (!string.IsNullOrEmpty(t)) return t;
        }
        return null;
    }
}

