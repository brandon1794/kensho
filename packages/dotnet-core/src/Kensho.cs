using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

namespace KaizenReport.Kensho.Core;

// Public helper API users call from inside test bodies:
//
//     using (Kensho.Step("open the login page")) { /* ... */ }
//     Kensho.Attach("/tmp/screen.png", kind: "screenshot");
//     Kensho.Label("team", "growth");
//     Kensho.Link("https://jira.example.com/browse/PROJ-123", kind: "jira");
//
// All four are no-ops outside a running test so it's safe to call them
// from shared utilities. The adapter listeners install/clear the current
// scratch via Kensho.SetCurrent(...) on test start/end.
public static class Kensho
{
    private static readonly AsyncLocal<CaseScratch?> Slot = new();

    public static CaseScratch? Current => Slot.Value;

    public static void SetCurrent(CaseScratch? scratch) => Slot.Value = scratch;

    public static string? CurrentCaseId => Slot.Value?.CaseId;

    public static IDisposable Step(string title, string? action = null)
    {
        var scratch = Slot.Value;
        if (scratch == null) return NoopStep.Instance;
        return new ActiveStep(scratch, title, action);
    }

    public static KenshoAttachment? Attach(string path, string? kind = null, string? name = null, string? mimeType = null)
    {
        var scratch = Slot.Value;
        if (scratch == null || scratch.Copier == null) return null;
        var att = scratch.Copier(scratch, path, kind, name, mimeType);
        if (att == null) return null;

        if (scratch.StepStack.Count > 0)
        {
            var top = scratch.StepStack.Peek();
            (top.Attachments ??= new List<KenshoAttachment>()).Add(att);
        }
        else
        {
            scratch.Attachments.Add(att);
        }
        return att;
    }

    public static void Label(string key, string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(key)) return;
        scratch.Labels[key] = value ?? string.Empty;
    }

    public static void Link(string url, string? kind = null, string? label = null)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(url)) return;
        var entry = new KenshoLink { Url = url };
        if (!string.IsNullOrEmpty(kind)) entry.Kind = kind;
        if (!string.IsNullOrEmpty(label)) entry.Label = label;
        scratch.Links.Add(entry);
    }

    public static void Log(string message, string level = "info")
    {
        var scratch = Slot.Value;
        if (scratch == null) return;
        var t = Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - scratch.StartedAtMs);
        scratch.Logs.Add(new KenshoLog { T = t, Level = level, Msg = message });
    }

    // ---- Behavior (epic / feature / story) -------------------------------
    // These set the BDD behavior tree the viewer groups by, and also mirror
    // into labels so consumers reading labels{} stay in sync. Story maps to
    // behavior.scenario (the schema's leaf node) but label key "story".

    public static void Epic(string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(value)) return;
        (scratch.Behavior ??= new KenshoBehavior()).Epic = value;
        scratch.Labels["epic"] = value;
    }

    public static void Feature(string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(value)) return;
        (scratch.Behavior ??= new KenshoBehavior()).Feature = value;
        scratch.Labels["feature"] = value;
    }

    public static void Story(string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(value)) return;
        (scratch.Behavior ??= new KenshoBehavior()).Scenario = value;
        scratch.Labels["story"] = value;
    }

    // ---- Classification --------------------------------------------------

    // Severity: validated against the schema enum; unknown values are ignored
    // (no-op) rather than written, so the run.json stays valid.
    public static void Severity(string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(value)) return;
        var lo = value.Trim().ToLowerInvariant();
        if (Array.IndexOf(KenshoSchema.Severity, lo) < 0) return;
        scratch.Severity = lo;
    }

    public static void Owner(string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(value)) return;
        scratch.Owner = value;
    }

    public static void Description(string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || value == null) return;
        scratch.Description = value;
    }

    public static void Tag(string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(value)) return;
        scratch.Tags.Add(value);
    }

    // ---- Parameters ------------------------------------------------------
    // Free-form name/value parameter (no kind — distinct from adapter-captured
    // [TestCase] arguments which carry kind:"argument").
    public static void Parameter(string name, string value)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(name)) return;
        scratch.Parameters.Add(new KenshoParameter
        {
            Name = name,
            Value = value ?? string.Empty,
        });
    }

    // ---- Links -----------------------------------------------------------
    // Convenience link helpers with canonical kinds. The general Kensho.Link()
    // above stays for arbitrary kinds.

    public static void JiraLink(string idOrUrl, string? label = null)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(idOrUrl)) return;
        scratch.Links.Add(new KenshoLink
        {
            Url = idOrUrl,
            Kind = "issue",
            Label = string.IsNullOrEmpty(label) ? null : label,
        });
    }

    public static void ReferenceLink(string url, string? label = null)
    {
        var scratch = Slot.Value;
        if (scratch == null || string.IsNullOrEmpty(url)) return;
        scratch.Links.Add(new KenshoLink
        {
            Url = url,
            Kind = "reference",
            Label = string.IsNullOrEmpty(label) ? null : label,
        });
    }

    // ---- Markers ---------------------------------------------------------

    // Flaky: flag the case as known-flaky. The listeners copy this onto
    // case.flaky so the viewer renders a flaky badge.
    public static void Flaky()
    {
        var scratch = Slot.Value;
        if (scratch == null) return;
        scratch.Flaky = true;
    }

    // Muted: known failure that shouldn't count against the pass gate.
    public static void Muted()
    {
        var scratch = Slot.Value;
        if (scratch == null) return;
        scratch.Muted = true;
    }

    // KnownIssue: mute the case and attach an issue link pointing at the
    // ticket, in one call.
    public static void KnownIssue(string idOrUrl, string? label = null)
    {
        var scratch = Slot.Value;
        if (scratch == null) return;
        scratch.Muted = true;
        if (!string.IsNullOrEmpty(idOrUrl))
        {
            scratch.Links.Add(new KenshoLink
            {
                Url = idOrUrl,
                Kind = "issue",
                Label = string.IsNullOrEmpty(label) ? null : label,
            });
        }
    }

    private sealed class NoopStep : IDisposable
    {
        public static readonly NoopStep Instance = new();
        public void Dispose() { }
    }

    private sealed class ActiveStep : IDisposable
    {
        private readonly CaseScratch _scratch;
        private readonly KenshoStep _step;
        private readonly Stopwatch _sw;
        private bool _disposed;

        public ActiveStep(CaseScratch scratch, string title, string? action)
        {
            _scratch = scratch;
            _sw = Stopwatch.StartNew();
            _step = new KenshoStep
            {
                Id = "step_" + Guid.NewGuid().ToString("N").Substring(0, 10),
                Title = title ?? string.Empty,
                Status = "pass",
                StartedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            };
            if (!string.IsNullOrEmpty(action))
            {
                // We don't have an "Action" property on KenshoStep in the POCO
                // (the schema field exists; we keep the POCO lean). If callers
                // need it, we promote action into the title prefix to stay
                // legal against the schema.
                _step.Title = $"{action}: {_step.Title}";
            }

            if (_scratch.StepStack.Count > 0)
            {
                var parent = _scratch.StepStack.Peek();
                (parent.Children ??= new List<KenshoStep>()).Add(_step);
            }
            else
            {
                _scratch.Steps.Add(_step);
            }
            _scratch.StepStack.Push(_step);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _sw.Stop();
            _step.Duration = _sw.ElapsedMilliseconds;
            // If the user didn't explicitly mark it failed, "pass" stays.
            // Adapters that wrap a step around an exception should set
            // status before disposal.
            if (_scratch.StepStack.Count > 0 && ReferenceEquals(_scratch.StepStack.Peek(), _step))
            {
                _scratch.StepStack.Pop();
            }
        }

        // Allow `using var s = Kensho.Step(...); s.Fail();` style if the
        // user wants to capture exception status without rethrowing.
        public ActiveStep Fail()
        {
            _step.Status = "fail";
            return this;
        }
    }
}
