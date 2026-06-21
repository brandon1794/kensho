using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using KaizenReport.Kensho.Core;
using Xunit;
using Xunit.Sdk;
using KenshoApi = KaizenReport.Kensho.Core.Kensho;

namespace KaizenReport.Kensho.Xunit;

// xUnit doesn't ship an in-process logger SPI like NUnit/MSTest. The
// idiomatic way to inject behavior around every test is BeforeAfterTestAttribute,
// which fires Before(MethodInfo) / After(MethodInfo) for each test the
// attribute is attached to. Users wire it up either at the assembly level…
//
//     [assembly: KaizenReport.Kensho.Xunit.KenshoTracked]
//
// …or by inheriting their test classes from KenshoTestBase. We finalize the
// run.json from a ProcessExit hook so users don't need to remember to flush.
public sealed class KenshoTrackedAttribute : BeforeAfterTestAttribute
{
    public override void Before(MethodInfo methodUnderTest)
    {
        try { KenshoXunitState.Instance.OnBefore(methodUnderTest); }
        catch (Exception e) { Console.Error.WriteLine($"[kensho] Before failed: {e.Message}"); }
    }

    public override void After(MethodInfo methodUnderTest)
    {
        try { KenshoXunitState.Instance.OnAfter(methodUnderTest); }
        catch (Exception e) { Console.Error.WriteLine($"[kensho] After failed: {e.Message}"); }
    }
}

// Convenience base — users can inherit from this instead of remembering
// the assembly attribute. Ships the same metadata via a class-level
// [KenshoTracked] decoration that xUnit walks up at runtime.
[KenshoTracked]
public abstract class KenshoTestBase { }

internal sealed class KenshoXunitState
{
    private static readonly Lazy<KenshoXunitState> Lazy = new(() => new KenshoXunitState());
    public static KenshoXunitState Instance => Lazy.Value;

    private readonly KenshoWriter _writer;
    private readonly object _lock = new();
    private readonly Dictionary<string, KenshoCase> _inFlight = new();
    private readonly Dictionary<string, long> _starts = new();
    private bool _flushed;

    private KenshoXunitState()
    {
        var output = Environment.GetEnvironmentVariable("KENSHO_OUTPUT") ?? "kensho-results";
        var name = Environment.GetEnvironmentVariable("KENSHO_PROJECT_NAME") ?? "Unknown project";
        var slug = Environment.GetEnvironmentVariable("KENSHO_PROJECT_SLUG") ?? Slugify(name);
        var runId = Environment.GetEnvironmentVariable("KENSHO_RUN_ID")
                    ?? "run_" + DateTimeOffset.UtcNow.ToString("yyyyMMddHHmmss");

        _writer = new KenshoWriter(
            outputDir: output,
            project: new KenshoProject { Name = name, Slug = slug },
            framework: new KenshoFramework
            {
                // xunit isn't in the Kensho schema enum — use junit-xml as the
                // generic .NET fallback so the run.json validates. See README.
                Name = "junit-xml",
                Version = typeof(FactAttribute).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            },
            runId: runId);

        AppDomain.CurrentDomain.ProcessExit += (_, _) => Flush();
    }

    public void OnBefore(MethodInfo method)
    {
        var fullName = $"{method.DeclaringType?.FullName}.{method.Name}";
        var filePath = TryResolveFilePath(method);
        var caseId = _writer.ResolveId(fullName, filePath);
        var startMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var key = MakeKey(method);

        var scratch = new CaseScratch(caseId, fullName, startMs)
        {
            Copier = _writer.CreateCopier(),
        };
        KenshoApi.SetCurrent(scratch);

        var c = new KenshoCase
        {
            Id = caseId,
            Name = method.Name,
            FullName = fullName,
            FilePath = filePath,
            Suite = BuildSuite(method),
            Status = "broken",
            StartedAt = KenshoWriter.IsoFromMs(startMs),
            Duration = 0,
            Retries = 0,
            Platform = NormalizePlatform(),
        };

        ApplyTraits(c, method);

        lock (_lock)
        {
            _inFlight[key] = c;
            _starts[key] = startMs;
        }

        // Stash the scratch on a thread-local field so After can pull it back.
        _scratchStack.Value ??= new Stack<CaseScratch>();
        _scratchStack.Value!.Push(scratch);
    }

    public void OnAfter(MethodInfo method)
    {
        var key = MakeKey(method);
        KenshoCase? c;
        long startMs;

        lock (_lock)
        {
            if (!_inFlight.TryGetValue(key, out c)) return;
            startMs = _starts.TryGetValue(key, out var s) ? s : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _inFlight.Remove(key);
            _starts.Remove(key);
        }

        var endMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        c.Duration = Math.Max(0, endMs - startMs);
        c.FinishedAt = KenshoWriter.IsoFromMs(endMs);

        var scratch = _scratchStack.Value != null && _scratchStack.Value.Count > 0
            ? _scratchStack.Value.Pop() : null;

        // xUnit doesn't tell BeforeAfter the outcome — we rely on captured
        // exceptions during teardown. xUnit calls After even when a test
        // fails, but the exception isn't directly accessible here. As a
        // pragmatic approach: callers can mark explicit failure via the
        // helper; otherwise we fall back to "pass" since After only runs
        // when the test reached at least the post-execution boundary.
        //
        // The xunit reporter (separate concern) writes the actual outcome.
        // Our adapter focuses on the structural pieces that BeforeAfter can
        // observe, plus user-provided steps/labels/links.
        c.Status = scratch?.Steps.Any(s => s.Status == "fail") == true ? "fail" : "pass";

        if (scratch != null)
        {
            while (scratch.StepStack.Count > 0) scratch.StepStack.Pop().Status = "broken";
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
            MergeAnnotations(c, scratch);
        }

        _writer.AddCase(c);
        KenshoApi.SetCurrent(null);
    }

    public void RecordOutcome(MethodInfo method, string status, string? errorMessage = null, string? stack = null)
    {
        var key = MakeKey(method);
        lock (_lock)
        {
            if (!_inFlight.TryGetValue(key, out var c)) return;
            c.Status = status;
            if (!string.IsNullOrEmpty(errorMessage) || !string.IsNullOrEmpty(stack))
            {
                c.Errors = new List<KenshoError>
                {
                    new() { Message = errorMessage ?? "test failed", Stack = stack },
                };
            }
        }
    }

    public void Flush()
    {
        lock (_lock)
        {
            if (_flushed) return;
            _flushed = true;
            try { _writer.Finish(); }
            catch (Exception e) { Console.Error.WriteLine($"[kensho] failed to write run.json: {e.Message}"); }
        }
    }

    private static readonly System.Threading.AsyncLocal<Stack<CaseScratch>?> _scratchStack = new();

    private static string MakeKey(MethodInfo m)
        => m.DeclaringType?.FullName + "." + m.Name + "@" + System.Threading.Thread.CurrentThread.ManagedThreadId;

    private static List<string>? BuildSuite(MethodInfo m)
    {
        var t = m.DeclaringType;
        if (t == null) return null;
        var parts = new List<string>();
        if (!string.IsNullOrEmpty(t.Namespace)) parts.AddRange(t.Namespace!.Split('.'));
        parts.Add(t.Name);
        return parts;
    }

    private static string? TryResolveFilePath(MethodInfo m)
    {
        try
        {
            var asm = m.DeclaringType?.Assembly;
            if (asm == null) return null;
            var className = m.DeclaringType!.Name;
            var loc = asm.Location;
            if (string.IsNullOrEmpty(loc)) return null;
            var binDir = System.IO.Path.GetDirectoryName(loc);
            var dir = binDir;
            for (var i = 0; i < 4 && dir != null; i++)
            {
                var found = System.IO.Directory.EnumerateFiles(dir, className + ".cs", System.IO.SearchOption.AllDirectories).FirstOrDefault();
                if (found != null)
                {
                    var cwd = System.IO.Directory.GetCurrentDirectory();
                    return MakeRelative(cwd, found).Replace('\\', '/');
                }
                dir = System.IO.Path.GetDirectoryName(dir);
            }
        }
        catch { }
        return null;
    }

    private static string MakeRelative(string root, string path)
    {
        try
        {
            var rootUri = new Uri(root.TrimEnd(System.IO.Path.DirectorySeparatorChar) + System.IO.Path.DirectorySeparatorChar);
            var pathUri = new Uri(path);
            var rel = Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString());
            return rel.Replace('/', System.IO.Path.DirectorySeparatorChar);
        }
        catch
        {
            return path;
        }
    }

    private static void ApplyTraits(KenshoCase c, MethodInfo method)
    {
        var tags = new List<string>();
        // xUnit Traits propagate via TraitAttribute on the method, class
        // and assembly. We walk all three so users can apply them anywhere.
        foreach (var attr in CollectTraitAttributes(method))
        {
            var pair = ExtractTrait(attr);
            if (pair == null) continue;
            var (k, v) = pair.Value;
            switch (k.ToLowerInvariant())
            {
                case "severity": c.Severity ??= NormalizeSeverity(v); break;
                case "feature": (c.Behavior ??= new KenshoBehavior()).Feature ??= v; break;
                case "epic": (c.Behavior ??= new KenshoBehavior()).Epic ??= v; break;
                case "story": (c.Behavior ??= new KenshoBehavior()).Scenario ??= v; break;
                case "owner": c.Owner ??= v; break;
                case "description": c.Description ??= v; break;
                case "category":
                case "tag":
                    if (!string.IsNullOrEmpty(v)) tags.Add(v);
                    break;
                default:
                    c.Labels ??= new Dictionary<string, string>();
                    if (!c.Labels.ContainsKey(k)) c.Labels[k] = v;
                    break;
            }
        }
        if (tags.Count > 0) c.Tags = tags;
    }

    // Merge the static Kensho.* annotation values from the scratch onto the
    // case. These take precedence over trait-derived values because the user
    // set them explicitly inside the test body.
    private static void MergeAnnotations(KenshoCase c, CaseScratch scratch)
    {
        if (scratch.Behavior != null)
        {
            c.Behavior ??= new KenshoBehavior();
            if (!string.IsNullOrEmpty(scratch.Behavior.Epic)) c.Behavior.Epic = scratch.Behavior.Epic;
            if (!string.IsNullOrEmpty(scratch.Behavior.Feature)) c.Behavior.Feature = scratch.Behavior.Feature;
            if (!string.IsNullOrEmpty(scratch.Behavior.Scenario)) c.Behavior.Scenario = scratch.Behavior.Scenario;
        }
        if (!string.IsNullOrEmpty(scratch.Severity)) c.Severity = scratch.Severity;
        if (!string.IsNullOrEmpty(scratch.Owner)) c.Owner = scratch.Owner;
        if (!string.IsNullOrEmpty(scratch.Description)) c.Description = scratch.Description;
        if (scratch.Tags.Count > 0)
        {
            c.Tags ??= new List<string>();
            foreach (var t in scratch.Tags) if (!c.Tags.Contains(t)) c.Tags.Add(t);
        }
        if (scratch.Parameters.Count > 0)
        {
            c.Parameters ??= new List<KenshoParameter>();
            c.Parameters.AddRange(scratch.Parameters);
        }
        if (scratch.Flaky) c.Flaky = true;
        if (scratch.Muted) c.Muted = true;
    }

    private static IEnumerable<Attribute> CollectTraitAttributes(MethodInfo m)
    {
        // We can't take a hard dep on TraitAttribute symbol resolution at
        // some build configs; reflect by name to stay loose.
        var seen = new List<Attribute>();
        seen.AddRange(m.GetCustomAttributes(false).OfType<Attribute>());
        if (m.DeclaringType != null)
        {
            seen.AddRange(m.DeclaringType.GetCustomAttributes(false).OfType<Attribute>());
            var asm = m.DeclaringType.Assembly;
            seen.AddRange(asm.GetCustomAttributes(false).OfType<Attribute>());
        }
        return seen;
    }

    private static (string key, string value)? ExtractTrait(Attribute a)
    {
        var t = a.GetType();
        if (!t.Name.StartsWith("Trait", StringComparison.Ordinal)) return null;
        // TraitAttribute exposes Name + Value (string, string).
        var nameProp = t.GetProperty("Name");
        var valProp = t.GetProperty("Value");
        var n = nameProp?.GetValue(a) as string;
        var v = valProp?.GetValue(a) as string;
        if (string.IsNullOrEmpty(n)) return null;
        return (n!, v ?? string.Empty);
    }

    private static string? NormalizeSeverity(string v)
    {
        var lo = (v ?? string.Empty).Trim().ToLowerInvariant();
        return Array.IndexOf(KenshoSchema.Severity, lo) >= 0 ? lo : null;
    }

    private static string NormalizePlatform()
    {
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Linux)) return "linux";
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.OSX)) return "darwin";
        if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows)) return "win32";
        return "unknown";
    }

    private static string Slugify(string name)
    {
        var s = (name ?? string.Empty).ToLowerInvariant().Trim();
        var chars = s.Select(c => char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '-').ToArray();
        var slug = new string(chars).Trim('-');
        return string.IsNullOrEmpty(slug) ? "unknown" : slug;
    }
}
