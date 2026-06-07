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
