"""Vendored slice of the Kensho v1 schema contract.

We deliberately do not depend on the JS ``@kaizenreport/kensho-schema`` package.
Adapters need to stay tiny and standalone, so we re-implement the few things
the listener cares about: the stable case-id hash, the status enum, the
attachment kind/MIME tables, and the environment-capture function.

This file is a verbatim copy of ``kensho_pytest._schema`` so the FNV-1a-based
``stable_case_id`` matches byte-for-byte across adapters.
"""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path
from typing import Dict, Optional

SCHEMA_VERSION = "kensho/v1"

STATUS = ("pass", "fail", "broken", "skip")
STEP_STATUS = ("pass", "fail", "skip")
SEVERITY = ("blocker", "critical", "normal", "minor", "trivial")
ATTACHMENT_KINDS = (
    "screenshot",
    "video",
    "trace",
    "har",
    "text",
    "json",
    "html",
    "dom-snapshot",
    "log",
)

MIME_BY_EXT: Dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".zip": "application/zip",
    ".html": "text/html",
    ".json": "application/json",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".har": "application/json",
}

KIND_BY_EXT: Dict[str, str] = {
    ".png": "screenshot",
    ".jpg": "screenshot",
    ".jpeg": "screenshot",
    ".webp": "screenshot",
    ".webm": "video",
    ".mp4": "video",
    ".zip": "trace",
    ".html": "html",
    ".json": "json",
    ".txt": "text",
    ".log": "log",
    ".har": "har",
}

_FNV_OFFSET_1 = 0x811C9DC5
_FNV_OFFSET_2 = 0x01000193
_PRIME_1 = 0x01000193
_PRIME_2 = 0x85EBCA6B
_MASK = 0xFFFFFFFF


def stable_case_id(full_name: str, file_path: Optional[str]) -> str:
    """Mirror ``stableCaseId`` from ``packages/schema/index.js``.

    Double FNV-1a so two 32-bit chunks come from independent rolling states.
    Must stay byte-for-byte identical to the JS implementation; that's how
    the platform correlates Robot, pytest, Playwright, and Go runs of the
    same suite to a single test history.
    """
    s = (full_name or "") + "::" + (file_path or "")
    h1 = _FNV_OFFSET_1
    h2 = _FNV_OFFSET_2
    for ch in s:
        c = ord(ch)
        h1 = ((h1 ^ c) * _PRIME_1) & _MASK
        h2 = ((h2 ^ c) * _PRIME_2) & _MASK
    return "tc_" + format(h1, "08x") + format(h2, "08x")


def env_info() -> Dict[str, object]:
    """Collect CI / environment metadata for ``run.env``."""
    is_ci = bool(os.environ.get("CI"))
    if is_ci and os.environ.get("GITHUB_ACTIONS"):
        ci = "github-actions"
    elif is_ci and os.environ.get("CIRCLECI"):
        ci = "circleci"
    elif is_ci and os.environ.get("GITLAB_CI"):
        ci = "gitlab"
    elif is_ci and os.environ.get("JENKINS_URL"):
        ci = "jenkins"
    elif is_ci and os.environ.get("BUILDKITE"):
        ci = "buildkite"
    elif is_ci and os.environ.get("TF_BUILD"):
        ci = "azure-devops"
    elif is_ci:
        ci = "unknown"
    else:
        ci = "local"

    branch = (
        os.environ.get("GITHUB_REF_NAME")
        or os.environ.get("CIRCLE_BRANCH")
        or os.environ.get("CI_COMMIT_REF_NAME")
        or os.environ.get("BUILDKITE_BRANCH")
    )
    commit = (
        os.environ.get("GITHUB_SHA")
        or os.environ.get("CIRCLE_SHA1")
        or os.environ.get("CI_COMMIT_SHA")
        or os.environ.get("BUILDKITE_COMMIT")
    )
    author = os.environ.get("KR_AUTHOR") or os.environ.get("GITHUB_ACTOR")
    commit_msg = os.environ.get("KR_COMMIT_MSG")

    run_url: Optional[str] = os.environ.get("KR_RUN_URL")
    gh_server = os.environ.get("GITHUB_SERVER_URL")
    gh_repo = os.environ.get("GITHUB_REPOSITORY")
    gh_run_id = os.environ.get("GITHUB_RUN_ID")
    if not run_url:
        if gh_server and gh_repo and gh_run_id:
            run_url = f"{gh_server}/{gh_repo}/actions/runs/{gh_run_id}"
        elif os.environ.get("CIRCLE_BUILD_URL"):
            run_url = os.environ["CIRCLE_BUILD_URL"]
        elif os.environ.get("CI_PIPELINE_URL"):
            run_url = os.environ["CI_PIPELINE_URL"]
        elif os.environ.get("CI_JOB_URL"):
            run_url = os.environ["CI_JOB_URL"]
        elif os.environ.get("BUILD_URL"):
            run_url = os.environ["BUILD_URL"]
        elif os.environ.get("BUILDKITE_BUILD_URL"):
            run_url = os.environ["BUILDKITE_BUILD_URL"]

    # repoUrl — KR_REPO_URL override → GitHub Actions / GitLab / Bitbucket /
    # Azure / SSH-style URLs from CircleCI / Buildkite / Jenkins (normalized).
    def _normalize_git_url(u: Optional[str]) -> Optional[str]:
        if not u:
            return None
        import re
        m = re.match(r"^(?:ssh://)?git@([^:/]+)[:/](.+?)(?:\.git)?$", u)
        if m:
            return f"https://{m.group(1)}/{m.group(2)}"
        return u[:-4] if u.endswith(".git") else u

    repo_url: Optional[str] = os.environ.get("KR_REPO_URL")
    if not repo_url:
        if gh_server and gh_repo:
            repo_url = f"{gh_server}/{gh_repo}"
        elif os.environ.get("CI_PROJECT_URL"):
            repo_url = os.environ["CI_PROJECT_URL"]
        elif os.environ.get("BITBUCKET_GIT_HTTP_ORIGIN"):
            repo_url = os.environ["BITBUCKET_GIT_HTTP_ORIGIN"]
        elif os.environ.get("BUILD_REPOSITORY_URI"):
            repo_url = _normalize_git_url(os.environ["BUILD_REPOSITORY_URI"])
        else:
            repo_url = _normalize_git_url(
                os.environ.get("CIRCLE_REPOSITORY_URL")
                or os.environ.get("BUILDKITE_REPO")
                or os.environ.get("GIT_URL")
            )

    info: Dict[str, object] = {
        "ci": ci,
        "os": _normalize_os(),
        "arch": platform.machine() or sys.platform,
        "pythonVersion": platform.python_version(),
    }
    if branch:
        info["branch"] = branch
    if commit:
        info["commit"] = commit
    if commit_msg:
        info["commitMsg"] = commit_msg
    if author:
        info["author"] = author
    if run_url:
        info["runUrl"] = run_url
    if repo_url:
        info["repoUrl"] = repo_url
    os_version = platform.release()
    if os_version:
        info["osVersion"] = os_version

    for var, key in (
        ("KR_STAGE", "stage"),
        ("KR_BASE_URL", "baseUrl"),
        ("KR_APP_VERSION", "appVersion"),
        ("KR_BUILD_NUMBER", "buildNumber"),
        ("KR_RELEASE", "release"),
        ("KR_REGION", "region"),
        ("KR_LOCALE", "locale"),
        ("KR_TRIGGER", "trigger"),
        ("KR_FEATURE", "feature"),
    ):
        v = os.environ.get(var)
        if v:
            info[key] = v
    return info


def _normalize_os() -> str:
    p = sys.platform
    if p.startswith("linux"):
        return "linux"
    if p == "darwin":
        return "darwin"
    if p in ("win32", "cygwin"):
        return "win32"
    return p


def kind_and_mime_for(path: str) -> tuple:
    """Return ``(kind, mimeType)`` defaulting to ``('text', 'application/octet-stream')``."""
    ext = Path(path).suffix.lower()
    kind = KIND_BY_EXT.get(ext, "text")
    mime = MIME_BY_EXT.get(ext, "application/octet-stream")
    return kind, mime
