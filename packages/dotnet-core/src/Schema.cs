using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace KaizenReport.Kensho.Core;

// Schema constants — kept in lock-step with packages/schema/index.js. The
// adapter must not silently drift from the canonical contract; any change
// here implies a corresponding bump on the JS side.
public static class KenshoSchema
{
    public const string Version = "kensho/v1";

    public static readonly string[] Status = { "pass", "fail", "broken", "skip" };
    public static readonly string[] StepStatus = { "pass", "fail", "skip" };
    public static readonly string[] Severity = { "blocker", "critical", "normal", "minor", "trivial" };
    public static readonly string[] AttachmentKinds =
    {
        "screenshot", "video", "trace", "har", "text", "json",
        "html", "dom-snapshot", "log",
    };
}

// POCOs match packages/schema/schema.json one-for-one. Nullable / [JsonIgnore
// WhenWritingNull] keeps optional fields out of the wire JSON so the report
// stays clean and the hand-rolled validator on the JS side stays happy.

public sealed class KenshoRun
{
    [JsonPropertyName("schemaVersion")]
    public string SchemaVersion { get; set; } = KenshoSchema.Version;

    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("project")]
    public KenshoProject Project { get; set; } = new();

    [JsonPropertyName("framework")]
    public KenshoFramework Framework { get; set; } = new();

    [JsonPropertyName("env"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public KenshoEnv? Env { get; set; }

    [JsonPropertyName("startedAt")]
    public string StartedAt { get; set; } = string.Empty;

    [JsonPropertyName("finishedAt")]
    public string FinishedAt { get; set; } = string.Empty;

    [JsonPropertyName("totals")]
    public KenshoTotals Totals { get; set; } = new();

    [JsonPropertyName("durationMs")]
    public long DurationMs { get; set; }

    [JsonPropertyName("testCases")]
    public List<KenshoCase> TestCases { get; set; } = new();
}

public sealed class KenshoProject
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "Unknown project";

    [JsonPropertyName("slug")]
    public string Slug { get; set; } = "unknown";

    [JsonPropertyName("url"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Url { get; set; }
}

public sealed class KenshoFramework
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "junit-xml";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "0.0.0";
}

public sealed class KenshoEnv
{
    [JsonPropertyName("ci"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Ci { get; set; }

    [JsonPropertyName("branch"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Branch { get; set; }

    [JsonPropertyName("commit"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Commit { get; set; }

    [JsonPropertyName("commitMsg"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CommitMsg { get; set; }

    [JsonPropertyName("author"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Author { get; set; }

    [JsonPropertyName("runUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RunUrl { get; set; }

    [JsonPropertyName("repoUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RepoUrl { get; set; }

    [JsonPropertyName("os"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Os { get; set; }

    [JsonPropertyName("osVersion"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? OsVersion { get; set; }

    [JsonPropertyName("arch"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Arch { get; set; }

    [JsonPropertyName("stage"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Stage { get; set; }

    [JsonPropertyName("baseUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? BaseUrl { get; set; }

    [JsonPropertyName("appVersion"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AppVersion { get; set; }

    [JsonPropertyName("buildNumber"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? BuildNumber { get; set; }

    [JsonPropertyName("release"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Release { get; set; }

    [JsonPropertyName("region"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Region { get; set; }

    [JsonPropertyName("locale"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Locale { get; set; }

    [JsonPropertyName("trigger"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Trigger { get; set; }

    [JsonPropertyName("feature"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Feature { get; set; }
}

public sealed class KenshoTotals
{
    [JsonPropertyName("pass")]
    public int Pass { get; set; }

    [JsonPropertyName("fail")]
    public int Fail { get; set; }

    [JsonPropertyName("broken")]
    public int Broken { get; set; }

    [JsonPropertyName("skip")]
    public int Skip { get; set; }
}

public sealed class KenshoCase
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("fullName")]
    public string FullName { get; set; } = string.Empty;

    [JsonPropertyName("filePath"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FilePath { get; set; }

    [JsonPropertyName("line"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Line { get; set; }

    [JsonPropertyName("suite"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Suite { get; set; }

    [JsonPropertyName("tags"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Tags { get; set; }

    [JsonPropertyName("severity"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Severity { get; set; }

    [JsonPropertyName("owner"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Owner { get; set; }

    [JsonPropertyName("labels"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, string>? Labels { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "broken";

    [JsonPropertyName("startedAt")]
    public string StartedAt { get; set; } = string.Empty;

    [JsonPropertyName("finishedAt"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FinishedAt { get; set; }

    [JsonPropertyName("duration")]
    public long Duration { get; set; }

    [JsonPropertyName("retries"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Retries { get; set; }

    [JsonPropertyName("platform"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Platform { get; set; }

    [JsonPropertyName("steps"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoStep>? Steps { get; set; }

    [JsonPropertyName("errors"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoError>? Errors { get; set; }

    [JsonPropertyName("attachments"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoAttachment>? Attachments { get; set; }

    [JsonPropertyName("logs"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoLog>? Logs { get; set; }

    [JsonPropertyName("behavior"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public KenshoBehavior? Behavior { get; set; }

    [JsonPropertyName("parameters"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoParameter>? Parameters { get; set; }

    [JsonPropertyName("description"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; set; }

    [JsonPropertyName("links"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoLink>? Links { get; set; }

    [JsonPropertyName("flaky"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Flaky { get; set; }

    [JsonPropertyName("muted"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Muted { get; set; }
}

public sealed class KenshoStep
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = "pass";

    [JsonPropertyName("startedAt")]
    public string StartedAt { get; set; } = string.Empty;

    [JsonPropertyName("duration")]
    public long Duration { get; set; }

    [JsonPropertyName("phase"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Phase { get; set; }

    [JsonPropertyName("attachments"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoAttachment>? Attachments { get; set; }

    [JsonPropertyName("logs"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoLog>? Logs { get; set; }

    [JsonPropertyName("children"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<KenshoStep>? Children { get; set; }
}

public sealed class KenshoBehavior
{
    [JsonPropertyName("epic"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Epic { get; set; }

    [JsonPropertyName("feature"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Feature { get; set; }

    [JsonPropertyName("scenario"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Scenario { get; set; }

    [JsonPropertyName("gherkin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Gherkin { get; set; }
}

public sealed class KenshoParameter
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("value")]
    public string Value { get; set; } = string.Empty;

    [JsonPropertyName("kind"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Kind { get; set; }

    [JsonPropertyName("hidden"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Hidden { get; set; }
}

public sealed class KenshoLink
{
    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;

    [JsonPropertyName("kind"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Kind { get; set; }

    [JsonPropertyName("label"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Label { get; set; }
}

public sealed class KenshoAttachment
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "text";

    [JsonPropertyName("relativePath")]
    public string RelativePath { get; set; } = string.Empty;

    [JsonPropertyName("mimeType")]
    public string MimeType { get; set; } = "application/octet-stream";

    [JsonPropertyName("sizeBytes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? SizeBytes { get; set; }
}

public sealed class KenshoError
{
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("stack"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Stack { get; set; }

    [JsonPropertyName("type"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Type { get; set; }
}

public sealed class KenshoLog
{
    [JsonPropertyName("t")]
    public long T { get; set; }

    [JsonPropertyName("level")]
    public string Level { get; set; } = "info";

    [JsonPropertyName("msg")]
    public string Msg { get; set; } = string.Empty;
}
