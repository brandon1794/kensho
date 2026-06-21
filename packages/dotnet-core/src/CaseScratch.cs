using System.Collections.Generic;

namespace KaizenReport.Kensho.Core;

// Per-test mutable scratch. The framework-specific listener creates one of
// these in the start-of-test hook and clears it at end-of-test, so the
// public Kensho.* helpers can mutate it from inside test bodies without
// each adapter inventing its own bookkeeping.
public sealed class CaseScratch
{
    public CaseScratch(string caseId, string fullName, long startedAtMs)
    {
        CaseId = caseId;
        FullName = fullName;
        StartedAtMs = startedAtMs;
    }

    public string CaseId { get; }
    public string FullName { get; }
    public long StartedAtMs { get; }

    public List<KenshoStep> Steps { get; } = new();
    public Stack<KenshoStep> StepStack { get; } = new();
    public List<KenshoAttachment> Attachments { get; } = new();
    public List<KenshoLog> Logs { get; } = new();
    public Dictionary<string, string> Labels { get; } = new();
    public List<KenshoLink> Links { get; } = new();
    public List<string> Tags { get; } = new();
    public List<KenshoParameter> Parameters { get; } = new();

    // Annotation values set by the Kensho.* static helpers from inside the
    // test body. The listeners merge these onto the case, taking precedence
    // over framework-attribute-derived values.
    public KenshoBehavior? Behavior { get; set; }
    public string? Severity { get; set; }
    public string? Owner { get; set; }
    public string? Description { get; set; }

    // Markers set by Kensho.Flaky() / Kensho.Muted() / Kensho.KnownIssue().
    // The listeners copy these onto the case in their merge step.
    public bool Flaky { get; set; }
    public bool Muted { get; set; }

    // Optional callback the listener wires up so Kensho.Attach can hand
    // the file off for copying into the attachments tree without the
    // helper module needing to know the output dir.
    public AttachmentCopier? Copier { get; set; }
}

public delegate KenshoAttachment? AttachmentCopier(
    CaseScratch scratch,
    string sourcePath,
    string? kind,
    string? name,
    string? mimeType);
