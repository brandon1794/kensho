using System;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace KaizenReport.Kensho.Core;

// Mirrors the env_info() / envInfo() helpers in the pytest and JS adapters
// so a Kensho report looks the same across language ecosystems. We resolve
// the CI provider, branch, commit, run URL and a few KR_* pass-through
// fields, then drop nulls before serializing.
public static class EnvCapture
{
    public static KenshoEnv Build()
    {
        var env = new KenshoEnv
        {
            Ci = ResolveCi(),
            Os = NormalizeOs(),
            OsVersion = Environment.OSVersion.Version.ToString(),
            Arch = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
            Branch = First(
                Environment.GetEnvironmentVariable("GITHUB_REF_NAME"),
                Environment.GetEnvironmentVariable("CIRCLE_BRANCH"),
                Environment.GetEnvironmentVariable("CI_COMMIT_REF_NAME"),
                Environment.GetEnvironmentVariable("BUILDKITE_BRANCH"),
                Environment.GetEnvironmentVariable("BUILD_SOURCEBRANCHNAME")),
            Commit = First(
                Environment.GetEnvironmentVariable("GITHUB_SHA"),
                Environment.GetEnvironmentVariable("CIRCLE_SHA1"),
                Environment.GetEnvironmentVariable("CI_COMMIT_SHA"),
                Environment.GetEnvironmentVariable("BUILDKITE_COMMIT"),
                Environment.GetEnvironmentVariable("BUILD_SOURCEVERSION")),
            CommitMsg = Environment.GetEnvironmentVariable("KR_COMMIT_MSG"),
            Author = First(
                Environment.GetEnvironmentVariable("KR_AUTHOR"),
                Environment.GetEnvironmentVariable("GITHUB_ACTOR"),
                Environment.GetEnvironmentVariable("BUILD_REQUESTEDFOR")),
            RunUrl = ResolveRunUrl(),
            RepoUrl = ResolveRepoUrl(),
            Stage = Environment.GetEnvironmentVariable("KR_STAGE"),
            BaseUrl = Environment.GetEnvironmentVariable("KR_BASE_URL"),
            AppVersion = Environment.GetEnvironmentVariable("KR_APP_VERSION"),
            BuildNumber = First(
                Environment.GetEnvironmentVariable("KR_BUILD_NUMBER"),
                Environment.GetEnvironmentVariable("BUILD_BUILDNUMBER"),
                Environment.GetEnvironmentVariable("GITHUB_RUN_NUMBER")),
            Release = Environment.GetEnvironmentVariable("KR_RELEASE"),
            Region = Environment.GetEnvironmentVariable("KR_REGION"),
            Locale = Environment.GetEnvironmentVariable("KR_LOCALE"),
            Trigger = Environment.GetEnvironmentVariable("KR_TRIGGER"),
            Feature = Environment.GetEnvironmentVariable("KR_FEATURE"),
        };
        return env;
    }

    private static string ResolveCi()
    {
        var isCi = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CI"));
        if (isCi && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GITHUB_ACTIONS"))) return "github-actions";
        if (isCi && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CIRCLECI"))) return "circleci";
        if (isCi && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GITLAB_CI"))) return "gitlab";
        if (isCi && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("JENKINS_URL"))) return "jenkins";
        if (isCi && !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("BUILDKITE"))) return "buildkite";
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("TF_BUILD"))) return "azure-devops";
        return isCi ? "unknown" : "local";
    }

    private static string? ResolveRunUrl()
    {
        var overrideUrl = Environment.GetEnvironmentVariable("KR_RUN_URL");
        if (!string.IsNullOrEmpty(overrideUrl)) return overrideUrl;

        var ghServer = Environment.GetEnvironmentVariable("GITHUB_SERVER_URL");
        var ghRepo = Environment.GetEnvironmentVariable("GITHUB_REPOSITORY");
        var ghRunId = Environment.GetEnvironmentVariable("GITHUB_RUN_ID");
        if (!string.IsNullOrEmpty(ghServer) && !string.IsNullOrEmpty(ghRepo) && !string.IsNullOrEmpty(ghRunId))
            return $"{ghServer}/{ghRepo}/actions/runs/{ghRunId}";

        return First(
            Environment.GetEnvironmentVariable("CI_PIPELINE_URL"),
            Environment.GetEnvironmentVariable("CIRCLE_BUILD_URL"),
            Environment.GetEnvironmentVariable("BUILDKITE_BUILD_URL"),
            Environment.GetEnvironmentVariable("CI_JOB_URL"),
            Environment.GetEnvironmentVariable("BUILD_URL"),
            ResolveAzureDevopsUrl());
    }

    // Mirrors deriveRepoUrl() in packages/schema/index.js: KR_REPO_URL override →
    // GitHub Actions → GitLab → Bitbucket → Azure → SSH-style URLs (CircleCI /
    // Buildkite / Jenkins), normalized to https form so the viewer can linkify
    // branch/commit chips.
    private static string? ResolveRepoUrl()
    {
        var overrideUrl = Environment.GetEnvironmentVariable("KR_REPO_URL");
        if (!string.IsNullOrEmpty(overrideUrl)) return overrideUrl;

        var ghServer = Environment.GetEnvironmentVariable("GITHUB_SERVER_URL");
        var ghRepo = Environment.GetEnvironmentVariable("GITHUB_REPOSITORY");
        if (!string.IsNullOrEmpty(ghServer) && !string.IsNullOrEmpty(ghRepo))
            return $"{ghServer}/{ghRepo}";

        var gitlab = Environment.GetEnvironmentVariable("CI_PROJECT_URL");
        if (!string.IsNullOrEmpty(gitlab)) return gitlab;

        var bitbucket = Environment.GetEnvironmentVariable("BITBUCKET_GIT_HTTP_ORIGIN");
        if (!string.IsNullOrEmpty(bitbucket)) return bitbucket;

        var azure = Environment.GetEnvironmentVariable("BUILD_REPOSITORY_URI");
        if (!string.IsNullOrEmpty(azure)) return NormalizeGitUrl(azure);

        return NormalizeGitUrl(First(
            Environment.GetEnvironmentVariable("CIRCLE_REPOSITORY_URL"),
            Environment.GetEnvironmentVariable("BUILDKITE_REPO"),
            Environment.GetEnvironmentVariable("GIT_URL")));
    }

    private static readonly Regex SshGitUrl = new(
        @"^(?:ssh://)?git@([^:/]+)[:/](.+?)(?:\.git)?$",
        RegexOptions.Compiled);

    private static string? NormalizeGitUrl(string? u)
    {
        if (string.IsNullOrEmpty(u)) return null;
        var m = SshGitUrl.Match(u!);
        if (m.Success) return $"https://{m.Groups[1].Value}/{m.Groups[2].Value}";
        return u!.EndsWith(".git", StringComparison.Ordinal) ? u.Substring(0, u.Length - 4) : u;
    }

    private static string? ResolveAzureDevopsUrl()
    {
        var col = Environment.GetEnvironmentVariable("SYSTEM_COLLECTIONURI");
        var proj = Environment.GetEnvironmentVariable("SYSTEM_TEAMPROJECT");
        var bid = Environment.GetEnvironmentVariable("BUILD_BUILDID");
        if (!string.IsNullOrEmpty(col) && !string.IsNullOrEmpty(proj) && !string.IsNullOrEmpty(bid))
            return $"{col!.TrimEnd('/')}/{proj}/_build/results?buildId={bid}";
        return null;
    }

    private static string NormalizeOs()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return "linux";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX)) return "darwin";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return "win32";
        return "unknown";
    }

    private static string? First(params string?[] values)
    {
        foreach (var v in values)
        {
            if (!string.IsNullOrEmpty(v)) return v;
        }
        return null;
    }
}
