using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace KaizenReport.Kensho.Core;

// Writes the kensho-results/ tree exactly the way every other adapter does:
//
//   kensho-results/
//     run.json                 manifest (project, env, totals, framework, timing)
//     cases/<stableId>.json    one file per test case
//     attachments/<caseId>/    files registered via Kensho.Attach
//
// Adapters call NewWriter(...), feed cases through AddCase + WriteCase as
// each test finishes, then call Finish() in the run-completion hook.
public sealed class KenshoWriter
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly Dictionary<string, int> _idCollisions = new();
    private readonly List<KenshoCase> _cases = new();

    public KenshoWriter(string outputDir, KenshoProject project, KenshoFramework framework, string runId)
    {
        OutputDir = Path.GetFullPath(outputDir);
        CasesDir = Path.Combine(OutputDir, "cases");
        AttachmentsDir = Path.Combine(OutputDir, "attachments");
        Project = project;
        Framework = framework;
        RunId = runId;
        StartedAt = NowIso();

        Directory.CreateDirectory(OutputDir);
        Directory.CreateDirectory(CasesDir);
        Directory.CreateDirectory(AttachmentsDir);
    }

    public string OutputDir { get; }
    public string CasesDir { get; }
    public string AttachmentsDir { get; }
    public KenshoProject Project { get; }
    public KenshoFramework Framework { get; }
    public string RunId { get; }
    public string StartedAt { get; }

    // De-dup case ids for parametrized tests that share the same fullName +
    // file (each iteration gets _2, _3, ...). Mirrors the JS+pytest logic.
    public string ResolveId(string fullName, string? filePath)
    {
        var baseId = StableId.Compute(fullName, filePath);
        var seen = _idCollisions.TryGetValue(baseId, out var n) ? n : 0;
        _idCollisions[baseId] = seen + 1;
        return seen == 0 ? baseId : $"{baseId}_{seen + 1}";
    }

    public void AddCase(KenshoCase c)
    {
        _cases.Add(c);
        WriteCaseFile(c);
    }

    public AttachmentCopier CreateCopier()
    {
        return (scratch, src, kind, name, mime) =>
        {
            try
            {
                if (string.IsNullOrEmpty(src) || !File.Exists(src)) return null;
                var caseDir = Path.Combine(AttachmentsDir, scratch.CaseId);
                Directory.CreateDirectory(caseDir);
                var attId = "att_" + Guid.NewGuid().ToString("N").Substring(0, 8);
                var destName = name ?? Path.GetFileName(src);
                var dest = Path.Combine(caseDir, $"{attId}_{destName}");
                File.Copy(src, dest, overwrite: true);
                var (guessedKind, guessedMime) = GuessKind(src);
                var fi = new FileInfo(dest);
                var rel = $"attachments/{scratch.CaseId}/{attId}_{destName}";
                return new KenshoAttachment
                {
                    Id = attId,
                    Kind = kind ?? guessedKind,
                    RelativePath = rel,
                    MimeType = mime ?? guessedMime,
                    SizeBytes = fi.Exists ? fi.Length : (long?)null,
                };
            }
            catch
            {
                return null;
            }
        };
    }

    public void Finish(KenshoEnv? env = null)
    {
        var finishedAt = NowIso();
        var run = new KenshoRun
        {
            Id = RunId,
            Project = Project,
            Framework = Framework,
            Env = env ?? EnvCapture.Build(),
            StartedAt = StartedAt,
            FinishedAt = finishedAt,
            Totals = ComputeTotals(_cases),
            DurationMs = Math.Max(0, ToMs(finishedAt) - ToMs(StartedAt)),
            TestCases = _cases,
        };
        var json = JsonSerializer.Serialize(run, JsonOpts);
        File.WriteAllText(Path.Combine(OutputDir, "run.json"), json);
    }

    private void WriteCaseFile(KenshoCase c)
    {
        var json = JsonSerializer.Serialize(c, JsonOpts);
        File.WriteAllText(Path.Combine(CasesDir, c.Id + ".json"), json);
    }

    private static KenshoTotals ComputeTotals(IEnumerable<KenshoCase> cases)
    {
        var t = new KenshoTotals();
        foreach (var c in cases)
        {
            switch (c.Status)
            {
                case "pass": t.Pass++; break;
                case "fail": t.Fail++; break;
                case "broken": t.Broken++; break;
                case "skip": t.Skip++; break;
            }
        }
        return t;
    }

    private static (string kind, string mime) GuessKind(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".png" => ("screenshot", "image/png"),
            ".jpg" => ("screenshot", "image/jpeg"),
            ".jpeg" => ("screenshot", "image/jpeg"),
            ".webp" => ("screenshot", "image/webp"),
            ".webm" => ("video", "video/webm"),
            ".mp4" => ("video", "video/mp4"),
            ".zip" => ("trace", "application/zip"),
            ".html" => ("html", "text/html"),
            ".json" => ("json", "application/json"),
            ".har" => ("har", "application/json"),
            ".txt" => ("text", "text/plain"),
            ".log" => ("log", "text/plain"),
            _ => ("text", "application/octet-stream"),
        };
    }

    public static string NowIso()
        => DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    public static string IsoFromMs(long ms)
        => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    private static long ToMs(string iso)
        => DateTimeOffset.Parse(iso, System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
}
