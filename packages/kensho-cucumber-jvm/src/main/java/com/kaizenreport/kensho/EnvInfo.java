package com.kaizenreport.kensho;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Best-effort CI / OS detection. Mirrors {@code envInfo()} in {@code packages/jest/index.js} and
 * {@code env_info()} in the pytest adapter so the report header looks the same regardless of which
 * adapter wrote it.
 */
public final class EnvInfo {

  private EnvInfo() {}

  public static Map<String, Object> capture() {
    Map<String, Object> info = new LinkedHashMap<>();
    info.put("ci", detectCi());
    info.put("os", normalizeOs());
    info.put("arch", System.getProperty("os.arch", "unknown"));

    String osVersion = System.getProperty("os.version");
    if (osVersion != null && !osVersion.isEmpty()) info.put("osVersion", osVersion);

    // The schema's env block doesn't define javaVersion; stash it under "vars" so a
    // strict (additionalProperties=false) consumer still accepts the run.
    Map<String, String> vars = new LinkedHashMap<>();
    String javaVersion = System.getProperty("java.version");
    if (javaVersion != null && !javaVersion.isEmpty()) vars.put("javaVersion", javaVersion);

    String branch =
        firstNonEmpty(
            System.getenv("GITHUB_REF_NAME"),
            System.getenv("CIRCLE_BRANCH"),
            System.getenv("CI_COMMIT_REF_NAME"),
            System.getenv("BUILDKITE_BRANCH"));
    if (branch != null) info.put("branch", branch);

    String commit =
        firstNonEmpty(
            System.getenv("GITHUB_SHA"),
            System.getenv("CIRCLE_SHA1"),
            System.getenv("CI_COMMIT_SHA"),
            System.getenv("BUILDKITE_COMMIT"));
    if (commit != null) info.put("commit", commit);

    String author = firstNonEmpty(System.getenv("KR_AUTHOR"), System.getenv("GITHUB_ACTOR"));
    if (author != null) info.put("author", author);

    String commitMsg = System.getenv("KR_COMMIT_MSG");
    if (commitMsg != null && !commitMsg.isEmpty()) info.put("commitMsg", commitMsg);

    String runUrl = detectRunUrl();
    if (runUrl != null) info.put("runUrl", runUrl);

    String repoUrl = detectRepoUrl();
    if (repoUrl != null) info.put("repoUrl", repoUrl);

    addEnvVar(info, "KR_STAGE", "stage");
    addEnvVar(info, "KR_BASE_URL", "baseUrl");
    addEnvVar(info, "KR_APP_VERSION", "appVersion");
    addEnvVar(info, "KR_BUILD_NUMBER", "buildNumber");
    addEnvVar(info, "KR_RELEASE", "release");
    addEnvVar(info, "KR_REGION", "region");
    addEnvVar(info, "KR_LOCALE", "locale");
    addEnvVar(info, "KR_TRIGGER", "trigger");
    addEnvVar(info, "KR_FEATURE", "feature");

    if (!vars.isEmpty()) info.put("vars", vars);
    return info;
  }

  private static String detectCi() {
    boolean isCi = !nullOrEmpty(System.getenv("CI"));
    if (isCi && !nullOrEmpty(System.getenv("GITHUB_ACTIONS"))) return "github-actions";
    if (isCi && !nullOrEmpty(System.getenv("CIRCLECI"))) return "circleci";
    if (isCi && !nullOrEmpty(System.getenv("GITLAB_CI"))) return "gitlab";
    if (isCi && !nullOrEmpty(System.getenv("JENKINS_URL"))) return "jenkins";
    if (isCi && !nullOrEmpty(System.getenv("BUILDKITE"))) return "buildkite";
    if (isCi && !nullOrEmpty(System.getenv("TF_BUILD"))) return "azure-devops";
    if (isCi) return "unknown";
    return "local";
  }

  private static String detectRunUrl() {
    String override = System.getenv("KR_RUN_URL");
    if (!nullOrEmpty(override)) return override;
    String ghServer = System.getenv("GITHUB_SERVER_URL");
    String ghRepo = System.getenv("GITHUB_REPOSITORY");
    String ghRunId = System.getenv("GITHUB_RUN_ID");
    if (!nullOrEmpty(ghServer) && !nullOrEmpty(ghRepo) && !nullOrEmpty(ghRunId)) {
      return ghServer + "/" + ghRepo + "/actions/runs/" + ghRunId;
    }
    return firstNonEmpty(
        System.getenv("CI_PIPELINE_URL"),
        System.getenv("CIRCLE_BUILD_URL"),
        System.getenv("BUILDKITE_BUILD_URL"),
        System.getenv("CI_JOB_URL"),
        System.getenv("BUILD_URL"));
  }

  /**
   * Mirrors {@code deriveRepoUrl()} in {@code packages/schema/index.js}: KR_REPO_URL override →
   * GitHub Actions → GitLab → Bitbucket → Azure → SSH-style URLs (CircleCI / Buildkite / Jenkins),
   * normalized to https form so the viewer can linkify branch/commit chips.
   */
  private static String detectRepoUrl() {
    String override = System.getenv("KR_REPO_URL");
    if (!nullOrEmpty(override)) return override;
    String ghServer = System.getenv("GITHUB_SERVER_URL");
    String ghRepo = System.getenv("GITHUB_REPOSITORY");
    if (!nullOrEmpty(ghServer) && !nullOrEmpty(ghRepo)) return ghServer + "/" + ghRepo;
    String gitlab = System.getenv("CI_PROJECT_URL");
    if (!nullOrEmpty(gitlab)) return gitlab;
    String bitbucket = System.getenv("BITBUCKET_GIT_HTTP_ORIGIN");
    if (!nullOrEmpty(bitbucket)) return bitbucket;
    String azure = System.getenv("BUILD_REPOSITORY_URI");
    if (!nullOrEmpty(azure)) return normalizeGitUrl(azure);
    return normalizeGitUrl(
        firstNonEmpty(
            System.getenv("CIRCLE_REPOSITORY_URL"),
            System.getenv("BUILDKITE_REPO"),
            System.getenv("GIT_URL")));
  }

  private static final Pattern SSH_GIT_URL =
      Pattern.compile("^(?:ssh://)?git@([^:/]+)[:/](.+?)(?:\\.git)?$");

  private static String normalizeGitUrl(String u) {
    if (nullOrEmpty(u)) return null;
    Matcher m = SSH_GIT_URL.matcher(u);
    if (m.matches()) return "https://" + m.group(1) + "/" + m.group(2);
    return u.endsWith(".git") ? u.substring(0, u.length() - 4) : u;
  }

  private static String normalizeOs() {
    String name = System.getProperty("os.name", "").toLowerCase();
    if (name.contains("linux")) return "linux";
    if (name.contains("mac") || name.contains("darwin")) return "darwin";
    if (name.contains("win")) return "win32";
    return name;
  }

  private static void addEnvVar(Map<String, Object> info, String var, String key) {
    String v = System.getenv(var);
    if (v != null && !v.isEmpty()) info.put(key, v);
  }

  private static String firstNonEmpty(String... values) {
    for (String v : values) {
      if (!nullOrEmpty(v)) return v;
    }
    return null;
  }

  private static boolean nullOrEmpty(String s) {
    return s == null || s.isEmpty();
  }
}
