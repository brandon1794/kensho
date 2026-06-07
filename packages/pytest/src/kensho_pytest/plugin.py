"""pytest plugin that emits Kensho v1 result bundles.

Layout written under ``--kensho-output`` (default ``kensho-results``)::

    kensho-results/
      run.json                 manifest (project, env, totals, framework, timing)
      cases/<stableId>.json    one file per test case
      attachments/<caseId>/    files registered via ``kensho_pytest.attach``

Hook flow:

* ``pytest_addoption``               register CLI flags.
* ``pytest_configure``               prepare output dirs, capture run start.
* ``pytest_collection_modifyitems``  remember collection order for stable
                                     suite-chain reconstruction.
* ``pytest_runtest_logstart``        open a per-test scratch for the helpers.
* ``pytest_runtest_logreport``       accumulate phase reports (setup/call/teardown).
* ``pytest_runtest_logfinish``       write ``cases/<id>.json``.
* ``pytest_sessionfinish``           write ``run.json``.

We never raise out of a hook — a broken reporter must not break the
test run. All exceptions are logged via ``warnings.warn``.
"""

from __future__ import annotations

import datetime as _dt
import io
import json
import os
import re
import shutil
import sys
import time
import uuid
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from . import _state
from ._schema import (
    SCHEMA_VERSION,
    SEVERITY,
    env_info,
    kind_and_mime_for,
    stable_case_id,
)
from ._state import CaseScratch

_PLUGIN_NAME = "kensho_pytest"

# Marks the plugin reads off test items. Kept in one place so the README and
# the implementation can never drift.
_KENSHO_MARKS = {
    "severity",  # @pytest.mark.severity('critical') — also @pytest.mark.critical
    "feature",
    "epic",
    "story",
    "description",
    "owner",
    "kensho_label",
    "kensho_link",
}

# Marks that, when present without arguments, set severity directly.
_SEVERITY_ALIAS_MARKS = set(SEVERITY)

# Marker names that should NOT bleed into ``case.tags``.
# These either get mapped to typed fields by the plugin or are pytest's
# own infrastructure markers.
_TAG_BLOCKLIST = (
    {
        "severity",
        "feature",
        "epic",
        "story",
        "description",
        "owner",
        "kensho_label",
        "kensho_link",
        "parametrize",
        "usefixtures",
        "skip",
        "skipif",
        "xfail",
        "filterwarnings",
        "tryfirst",
        "trylast",
    }
    | _SEVERITY_ALIAS_MARKS
)


# --------------------------------------------------------------------------- #
# CLI flags + ini hooks
# --------------------------------------------------------------------------- #


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("kensho", "Kensho test report (kensho-pytest)")
    group.addoption(
        "--kensho-output",
        action="store",
        default=None,
        dest="kensho_output",
        help="Directory to write kensho-results/ into (default: ./kensho-results)",
    )
    group.addoption(
        "--kensho-project-name",
        action="store",
        default=None,
        dest="kensho_project_name",
        help="Project name to embed in run.json",
    )
    group.addoption(
        "--kensho-project-slug",
        action="store",
        default=None,
        dest="kensho_project_slug",
        help="Project slug (lowercase, alphanum + dash/underscore)",
    )
    group.addoption(
        "--kensho-run-id",
        action="store",
        default=None,
        dest="kensho_run_id",
        help="Override the auto-generated run id",
    )
    group.addoption(
        "--kensho-no-severity-from-marks",
        action="store_true",
        default=False,
        dest="kensho_no_severity_from_marks",
        help="Disable mapping @pytest.mark.<severity> to case.severity",
    )
    parser.addini("kensho_output", "Output dir for kensho-results/", default="")
    parser.addini("kensho_project_name", "Kensho project name", default="")
    parser.addini("kensho_project_slug", "Kensho project slug", default="")


def pytest_configure(config: pytest.Config) -> None:
    # Register custom marks so pytest doesn't warn on them.
    for m in _KENSHO_MARKS:
        config.addinivalue_line("markers", f"{m}(...): Kensho metadata marker")
    for m in _SEVERITY_ALIAS_MARKS:
        config.addinivalue_line(
            "markers", f"{m}: shorthand for @pytest.mark.severity('{m}')"
        )

    # Don't double-register on pytest re-entry (e.g. when running via pytester).
    if config.pluginmanager.has_plugin(_PLUGIN_NAME):
        return

    output = (
        config.getoption("kensho_output")
        or config.getini("kensho_output")
        or "kensho-results"
    )
    project_name = (
        config.getoption("kensho_project_name")
        or config.getini("kensho_project_name")
        or "Unknown project"
    )
    project_slug = (
        config.getoption("kensho_project_slug")
        or config.getini("kensho_project_slug")
        or _slugify(project_name)
    )
    run_id = config.getoption("kensho_run_id") or _default_run_id()
    severity_from_marks = not config.getoption("kensho_no_severity_from_marks")

    output_dir = Path(str(output)).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "cases").mkdir(parents=True, exist_ok=True)
    (output_dir / "attachments").mkdir(parents=True, exist_ok=True)

    # Best-effort cwd-relative root for filePath fields.
    try:
        rootpath = Path(str(config.rootpath)).resolve()
    except Exception:
        rootpath = Path.cwd()

    plugin = KenshoPlugin(
        output_dir=output_dir,
        project={"name": project_name, "slug": project_slug},
        run_id=run_id,
        severity_from_marks=severity_from_marks,
        rootpath=rootpath,
    )
    config.pluginmanager.register(plugin, _PLUGIN_NAME)
    _state.set_plugin(plugin)


# --------------------------------------------------------------------------- #
# Plugin object — holds run-wide state and implements the hooks.
# --------------------------------------------------------------------------- #


class KenshoPlugin:
    """Single-instance plugin that owns the run-wide state."""

    def __init__(
        self,
        *,
        output_dir: Path,
        project: Dict[str, str],
        run_id: str,
        severity_from_marks: bool,
        rootpath: Path,
    ) -> None:
        self.output_dir = output_dir
        self.cases_dir = output_dir / "cases"
        self.attachments_dir = output_dir / "attachments"
        self.project = project
        self.run_id = run_id
        self.severity_from_marks = severity_from_marks
        self.rootpath = rootpath
        self.started_at = _now_iso()
        self._started_perf = time.time()

        # nodeid -> partial case dict accumulated across phases.
        self._cases: Dict[str, Dict[str, Any]] = {}
        # nodeid -> phase reports captured by logreport.
        self._reports: Dict[str, Dict[str, pytest.TestReport]] = {}
        # ids already written, so duplicate parametrizations get suffixed.
        self._ids_seen: Dict[str, int] = {}
        # nodeid -> CaseScratch (created in logstart, used by helpers).
        self._scratches: Dict[str, CaseScratch] = {}
        # Final case dicts keyed by id, written-out copy.
        self._cases_by_id: Dict[str, Dict[str, Any]] = {}

    # ----- collection ----- #

    def pytest_collection_modifyitems(
        self,
        config: pytest.Config,  # noqa: ARG002
        items: List[pytest.Item],
    ) -> None:
        # Pre-create case skeletons so we can track id collisions even for
        # tests that error during collection.
        for item in items:
            self._ensure_case(item)

    # ----- per-test lifecycle ----- #

    def pytest_runtest_logstart(
        self, nodeid: str, location: tuple
    ) -> None:  # noqa: ARG002
        case = self._cases.get(nodeid)
        if case is None:
            return
        scratch = CaseScratch(
            case_id=case["id"],
            nodeid=nodeid,
            started_at_ms=time.time() * 1000.0,
        )
        self._scratches[nodeid] = scratch
        _state.set_current(scratch)

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        bucket = self._reports.setdefault(report.nodeid, {})
        bucket[report.when] = report

    def pytest_runtest_logfinish(
        self, nodeid: str, location: tuple
    ) -> None:  # noqa: ARG002
        try:
            self._finalize_case(nodeid)
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(
                f"[kensho] failed to finalize {nodeid}: {exc}", stacklevel=2
            )
        finally:
            self._scratches.pop(nodeid, None)
            _state.set_current(None)

    # ----- session ----- #

    def pytest_sessionfinish(
        self,
        session: pytest.Session,  # noqa: ARG002
        exitstatus: int,  # noqa: ARG002
    ) -> None:
        try:
            self._write_run_json()
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho] failed to write run.json: {exc}", stacklevel=2)
        finally:
            _state.set_plugin(None)

    def pytest_terminal_summary(
        self,
        terminalreporter: Any,
        exitstatus: int,  # noqa: ARG002
        config: pytest.Config,  # noqa: ARG002
    ) -> None:
        rel = self._safe_relpath(self.output_dir)
        terminalreporter.write_sep(
            "-",
            f"[kensho] wrote {len(self._cases_by_id)} cases + run.json to {rel}",
            blue=True,
        )

    # ----- internals ----- #

    def _ensure_case(self, item: pytest.Item) -> Dict[str, Any]:
        nodeid = item.nodeid
        if nodeid in self._cases:
            return self._cases[nodeid]

        full_name = nodeid
        file_path = self._rel_path(item)
        line = _line_of(item)
        suite, name = _split_nodeid(nodeid)

        base_id = stable_case_id(full_name, file_path)
        seen = self._ids_seen.get(base_id, 0)
        if seen == 0:
            case_id = base_id
        else:
            case_id = f"{base_id}_{seen + 1}"
        self._ids_seen[base_id] = seen + 1

        marker_data = _collect_marker_data(item)

        tags: List[str] = []
        # Tags = free-form markers only. Markers we already mapped to
        # typed fields (severity/feature/epic/story/owner/description/
        # kensho_*) and pytest infrastructure markers
        # (parametrize/usefixtures/skip/skipif/xfail) are NOT tags —
        # otherwise the report renders e.g. "kensho_link" as a tag chip
        # which is just noise.
        for mark_name in marker_data["mark_names"]:
            if mark_name in _TAG_BLOCKLIST:
                continue
            if mark_name in tags:
                continue
            tags.append(mark_name)
        # Allow "@tag" inline in the test name too (rare but consistent
        # with the JS adapters).
        for inline in _extract_inline_tags(name):
            if inline not in tags:
                tags.append(inline)

        severity = None
        if self.severity_from_marks:
            severity = marker_data["severity"]

        behavior: Dict[str, Any] = {}
        if marker_data["epic"]:
            behavior["epic"] = marker_data["epic"]
        if marker_data["feature"]:
            behavior["feature"] = marker_data["feature"]
        if marker_data["story"]:
            behavior["scenario"] = marker_data["story"]

        labels: Dict[str, str] = {}
        labels.update(marker_data["labels"])

        links: List[Dict[str, str]] = list(marker_data["links"])

        parameters: List[Dict[str, str]] = []
        for pname, pval in marker_data["parameters"].items():
            parameters.append(
                {"name": str(pname), "value": _stringify(pval), "kind": "argument"}
            )

        case: Dict[str, Any] = {
            "id": case_id,
            "name": name,
            "fullName": full_name,
            "filePath": file_path,
            "suite": suite,
            "tags": tags,
            "status": "skip",  # placeholder until logreport overwrites
            "startedAt": self.started_at,
            "duration": 0,
            "retries": 0,
            "platform": _platform_str(),
        }
        if line is not None:
            case["line"] = line
        if severity:
            case["severity"] = severity
        if marker_data["owner"]:
            case["owner"] = marker_data["owner"]
        if behavior:
            case["behavior"] = behavior
        if labels:
            case["labels"] = labels
        if links:
            case["links"] = links
        if parameters:
            case["parameters"] = parameters
        if marker_data["description"]:
            case["description"] = marker_data["description"]

        self._cases[nodeid] = case
        return case

    def _finalize_case(self, nodeid: str) -> None:
        case = self._cases.get(nodeid)
        if case is None:
            return
        reports = self._reports.get(nodeid, {})
        scratch = self._scratches.get(nodeid)

        setup = reports.get("setup")
        call = reports.get("call")
        teardown = reports.get("teardown")

        # Wallclock — prefer the actual setup start the helpers recorded.
        if scratch is not None:
            started_ms = scratch.started_at_ms
        elif setup is not None and getattr(setup, "start", None):
            started_ms = setup.start * 1000.0
        else:
            started_ms = time.time() * 1000.0

        # Duration — sum of all phases pytest reports.
        duration_ms = 0.0
        for r in (setup, call, teardown):
            if r is not None:
                duration_ms += float(getattr(r, "duration", 0.0)) * 1000.0
        duration = max(0, int(round(duration_ms)))

        status = _resolve_status(setup, call, teardown)
        errors = _collect_errors(setup, call, teardown)
        logs = _collect_logs(setup, call, teardown, started_ms)
        if scratch is not None:
            logs.extend(scratch.logs)

        case["status"] = status
        case["startedAt"] = _iso_from_ms(started_ms)
        case["finishedAt"] = _iso_from_ms(started_ms + duration)
        case["duration"] = duration

        if errors:
            case["errors"] = errors
        if logs:
            case["logs"] = logs

        if scratch is not None:
            # Auto-close any steps the user forgot to exit. Mark them broken
            # so the report makes the leak visible.
            while scratch.step_stack:
                _close_step(scratch.step_stack.pop(), status="broken")
            if scratch.steps:
                case["steps"] = scratch.steps
            if scratch.attachments:
                case["attachments"] = scratch.attachments
            if scratch.labels:
                case.setdefault("labels", {}).update(scratch.labels)
            if scratch.links:
                case.setdefault("links", []).extend(scratch.links)

        # Drop empty optional fields the schema treats as additionalProperties=false-safe
        # but that just clutter the JSON.
        for k in ("suite", "tags"):
            if k in case and not case[k]:
                del case[k]

        # Write the case file.
        path = self.cases_dir / f"{case['id']}.json"
        try:
            path.write_text(json.dumps(case, indent=2), encoding="utf-8")
        except OSError as exc:
            warnings.warn(
                f"[kensho] could not write {path.name}: {exc}", stacklevel=2
            )
            return
        self._cases_by_id[case["id"]] = case

    def _write_run_json(self) -> None:
        finished_at = _now_iso()
        cases = list(self._cases_by_id.values())
        totals = {"pass": 0, "fail": 0, "broken": 0, "skip": 0}
        for c in cases:
            s = c.get("status")
            if s in totals:
                totals[s] += 1
        duration_ms = max(0, int(round((time.time() - self._started_perf) * 1000)))
        run = {
            "schemaVersion": SCHEMA_VERSION,
            "id": self.run_id,
            "project": dict(self.project),
            "framework": {
                "name": "pytest",
                "version": _safe_version("pytest", default=pytest.__version__),
            },
            "env": env_info(),
            "startedAt": self.started_at,
            "finishedAt": finished_at,
            "totals": totals,
            "durationMs": duration_ms,
            "testCases": cases,
        }
        path = self.output_dir / "run.json"
        path.write_text(json.dumps(run, indent=2), encoding="utf-8")

    # ----- helpers used by the public API ----- #

    def register_attachment(
        self,
        case: CaseScratch,
        src: Path,
        kind: Optional[str],
        name: Optional[str],
        mime_type: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        if not src.exists() or not src.is_file():
            warnings.warn(f"[kensho] attachment not found: {src}", stacklevel=3)
            return None
        attachments_root = self.attachments_dir / case.case_id
        attachments_root.mkdir(parents=True, exist_ok=True)
        att_id = "att_" + uuid.uuid4().hex[:8]
        dest_name = (name or src.name)
        # Avoid collisions with pre-existing files in the attachments dir.
        dest = attachments_root / f"{att_id}_{dest_name}"
        try:
            shutil.copyfile(src, dest)
        except OSError as exc:
            warnings.warn(f"[kensho] failed to copy {src}: {exc}", stacklevel=3)
            return None
        guessed_kind, guessed_mime = kind_and_mime_for(str(src))
        record: Dict[str, Any] = {
            "id": att_id,
            "kind": kind or guessed_kind,
            "relativePath": str(dest.relative_to(self.output_dir).as_posix()),
            "mimeType": mime_type or guessed_mime,
        }
        try:
            record["sizeBytes"] = dest.stat().st_size
        except OSError:
            pass
        return record

    # Used by tests to introspect.
    @property
    def cases(self) -> Dict[str, Dict[str, Any]]:
        return self._cases_by_id

    def _rel_path(self, item: pytest.Item) -> Optional[str]:
        try:
            p = Path(str(item.path)).resolve()
        except Exception:
            return None
        try:
            return str(p.relative_to(self.rootpath).as_posix())
        except ValueError:
            return str(p.as_posix())

    def _safe_relpath(self, p: Path) -> str:
        try:
            return str(p.relative_to(self.rootpath).as_posix())
        except ValueError:
            return str(p.as_posix())


# --------------------------------------------------------------------------- #
# Marker / report helpers
# --------------------------------------------------------------------------- #


def _collect_marker_data(item: pytest.Item) -> Dict[str, Any]:
    """Pull Kensho-relevant info out of an item's marks.

    Supported markers (also documented in the README):

    * ``@pytest.mark.severity('critical')`` — sets ``case.severity``.
    * ``@pytest.mark.<severity>`` — shorthand alias (e.g. ``@pytest.mark.blocker``).
    * ``@pytest.mark.feature('Cart')`` / ``epic('Checkout')`` / ``story('Empty cart shows CTA')``.
    * ``@pytest.mark.description('...')``.
    * ``@pytest.mark.owner('alice')``.
    * ``@pytest.mark.kensho_label(env='staging', service='cart')`` — arbitrary string labels.
    * ``@pytest.mark.kensho_link(kind='jira', url='...', label='PROJ-123')``
      (or pass them positionally: ``kensho_link('jira', 'https://...', 'PROJ-123')``).
    """
    out: Dict[str, Any] = {
        "severity": None,
        "feature": None,
        "epic": None,
        "story": None,
        "description": None,
        "owner": None,
        "labels": {},
        "links": [],
        "parameters": {},
        "mark_names": [],
    }
    for marker in item.iter_markers():
        out["mark_names"].append(marker.name)
        if marker.name == "severity":
            value = marker.args[0] if marker.args else marker.kwargs.get("level")
            if isinstance(value, str) and value.lower() in SEVERITY:
                out["severity"] = value.lower()
        elif marker.name in _SEVERITY_ALIAS_MARKS:
            out["severity"] = out["severity"] or marker.name
        elif marker.name == "feature" and marker.args:
            out["feature"] = str(marker.args[0])
        elif marker.name == "epic" and marker.args:
            out["epic"] = str(marker.args[0])
        elif marker.name == "story" and marker.args:
            out["story"] = str(marker.args[0])
        elif marker.name == "description" and marker.args:
            out["description"] = str(marker.args[0])
        elif marker.name == "owner" and marker.args:
            out["owner"] = str(marker.args[0])
        elif marker.name == "kensho_label":
            for k, v in (marker.kwargs or {}).items():
                if v is None:
                    continue
                out["labels"][str(k)] = str(v)
            # Also accept ('key', 'value') positional form.
            args = list(marker.args or [])
            while len(args) >= 2:
                k = args.pop(0)
                v = args.pop(0)
                out["labels"][str(k)] = str(v)
        elif marker.name == "kensho_link":
            link = _normalize_link(marker.args, marker.kwargs)
            if link:
                out["links"].append(link)

    # Extract parametrize values from callspec.
    callspec = getattr(item, "callspec", None)
    if callspec is not None:
        params = getattr(callspec, "params", {}) or {}
        for k, v in params.items():
            out["parameters"][k] = v

    return out


def _normalize_link(args: tuple, kwargs: dict) -> Optional[Dict[str, str]]:
    kwargs = dict(kwargs or {})
    args = list(args or [])
    if args and "url" not in kwargs:
        # Common forms: link('url'), link('jira', 'url'), link('jira', 'url', 'label')
        if len(args) == 1:
            kwargs["url"] = args[0]
        elif len(args) >= 2:
            kwargs.setdefault("kind", args[0])
            kwargs.setdefault("url", args[1])
            if len(args) >= 3:
                kwargs.setdefault("label", args[2])
    url = kwargs.get("url")
    if not url:
        return None
    link: Dict[str, str] = {"url": str(url)}
    if kwargs.get("kind"):
        link["kind"] = str(kwargs["kind"])
    if kwargs.get("label"):
        link["label"] = str(kwargs["label"])
    return link


def _split_nodeid(nodeid: str) -> tuple:
    """Split ``tests/test_x.py::TestThing::test_y[param]`` -> (suite, name).

    ``suite`` is everything between the file and the test name (e.g. class).
    ``name`` is the last segment, parametrize id and all.
    """
    if "::" not in nodeid:
        return [], nodeid
    parts = nodeid.split("::")
    file_part = parts[0]  # noqa: F841 — kept for clarity
    rest = parts[1:]
    if not rest:
        return [], nodeid
    name = rest[-1]
    suite = rest[:-1]
    return suite, name


def _extract_inline_tags(title: str) -> List[str]:
    return re.findall(r"@([\w-]+)", title or "")


def _line_of(item: pytest.Item) -> Optional[int]:
    loc = getattr(item, "location", None)
    if loc and len(loc) >= 2 and isinstance(loc[1], int):
        # pytest stores 0-indexed lines; adapters expect 1-indexed.
        return int(loc[1]) + 1
    return None


def _resolve_status(
    setup: Optional[pytest.TestReport],
    call: Optional[pytest.TestReport],
    teardown: Optional[pytest.TestReport],
) -> str:
    """Map the three phase outcomes to a single Kensho status.

    Priority: setup/teardown failure → broken; call failure → fail;
    skipped (any phase) → skip; otherwise pass. Any "errored" outcome
    (uncommon, but emitted for collect failures) → broken.
    """

    def is_skipped(r: Optional[pytest.TestReport]) -> bool:
        return r is not None and r.outcome == "skipped"

    def is_failed(r: Optional[pytest.TestReport]) -> bool:
        return r is not None and r.outcome == "failed"

    if is_failed(setup) or is_failed(teardown):
        # Hook errors are infrastructure failures, not real test failures.
        return "broken"
    if is_failed(call):
        return "fail"
    if is_skipped(setup) or is_skipped(call) or is_skipped(teardown):
        return "skip"
    if call is None and setup is None and teardown is None:
        return "broken"
    return "pass"


def _collect_errors(
    setup: Optional[pytest.TestReport],
    call: Optional[pytest.TestReport],
    teardown: Optional[pytest.TestReport],
) -> List[Dict[str, str]]:
    errors: List[Dict[str, str]] = []
    for label, r in (("setup", setup), ("call", call), ("teardown", teardown)):
        if r is None or r.outcome != "failed":
            continue
        repr_obj = getattr(r, "longrepr", None)
        stack = _format_repr(repr_obj)
        # Prefer pytest's own crash summary ("AssertionError: cart total
        # mismatch") over the first source-code line of the longrepr.
        crash_msg = _crash_message(repr_obj)
        message = crash_msg or _first_line(stack) or f"{label} failed"
        err: Dict[str, str] = {"message": message}
        if stack and stack != message:
            err["stack"] = stack
        type_ = _extract_exc_type(repr_obj)
        if type_:
            err["type"] = type_
        errors.append(err)
    return errors


def _crash_message(repr_obj: Any) -> Optional[str]:
    crash = getattr(repr_obj, "reprcrash", None)
    msg = getattr(crash, "message", None)
    if isinstance(msg, str) and msg.strip():
        return _first_line(msg)
    return None


def _collect_logs(
    setup: Optional[pytest.TestReport],
    call: Optional[pytest.TestReport],
    teardown: Optional[pytest.TestReport],
    started_at_ms: float,
) -> List[Dict[str, Any]]:
    """Convert captured stdout/stderr from each phase into Kensho log entries.

    Pytest's TestReport carries the same ``capstdout`` / ``capstderr``
    text in multiple phase reports — the teardown report typically
    contains the call phase's capture too. We track which (level, msg)
    pairs we've already emitted so the report doesn't show duplicates.
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for r in (setup, call, teardown):
        if r is None:
            continue
        # capstderr / capstdout / caplog are the standard attribute names.
        captured = []
        for attr, level in (
            ("capstdout", "info"),
            ("capstderr", "warn"),
            ("caplog", "info"),
        ):
            text = getattr(r, attr, None)
            if text:
                captured.append((level, text))
        if not captured:
            continue
        when_start = getattr(r, "start", None)
        if when_start is not None:
            offset = max(0, int(round(when_start * 1000.0 - started_at_ms)))
        else:
            offset = 0
        for level, text in captured:
            for line in _split_lines(text):
                if not line:
                    continue
                key = (level, line)
                if key in seen:
                    continue
                seen.add(key)
                out.append({"t": offset, "level": level, "msg": line})
    return out


def _format_repr(repr_obj: Any) -> str:
    if repr_obj is None:
        return ""
    if isinstance(repr_obj, str):
        return repr_obj
    # pytest.ExceptionChainRepr / ReprFileLocation / etc. all support str().
    try:
        buf = io.StringIO()
        if hasattr(repr_obj, "toterminal"):
            class _Sink:
                def __init__(self, b: io.StringIO) -> None:
                    self._b = b

                def line(self, s: str = "", **_: Any) -> None:
                    self._b.write(s + "\n")

                def write(self, s: str, **_: Any) -> None:
                    self._b.write(s)

                def sep(self, sep: str, title: str = "", **_: Any) -> None:
                    bar = sep * 8
                    self._b.write(f"{bar} {title} {bar}\n" if title else f"{bar}\n")

                def write_line(self, s: str = "", **_: Any) -> None:
                    self._b.write(s + "\n")

                # pytest's TerminalWriter has a fullwidth attr.
                fullwidth = 80

                def hasmarkup(self) -> bool:
                    return False

            repr_obj.toterminal(_Sink(buf))
            return buf.getvalue().rstrip()
    except Exception:
        pass
    return str(repr_obj)


def _extract_exc_type(repr_obj: Any) -> Optional[str]:
    # pytest ExceptionChainRepr → reprcrash.message starts with "ExceptionType: ..."
    crash = getattr(repr_obj, "reprcrash", None)
    msg = getattr(crash, "message", None)
    if isinstance(msg, str) and ":" in msg:
        head = msg.split(":", 1)[0].strip()
        if head and head[0].isalpha() and " " not in head:
            return head
    return None


def _first_line(s: str) -> str:
    if not s:
        return ""
    for line in s.splitlines():
        line = line.strip()
        if line:
            return line
    return ""


def _split_lines(text: str) -> List[str]:
    if not text:
        return []
    return [ln.rstrip() for ln in text.splitlines()]


def _close_step(step: Dict[str, Any], status: str) -> None:
    """Set duration + status on a step that's being closed."""
    step.setdefault("status", status)
    started = step.get("_startedPerf")
    if started is not None:
        step["duration"] = max(0, int(round((time.time() - started) * 1000)))
        del step["_startedPerf"]
    else:
        step.setdefault("duration", 0)


def _stringify(v: Any) -> str:
    try:
        return repr(v)
    except Exception:
        return "<unrepr>"


def _platform_str() -> str:
    p = sys.platform
    if p.startswith("linux"):
        return "linux"
    if p == "darwin":
        return "darwin"
    if p in ("win32", "cygwin"):
        return "win32"
    return p


def _now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _iso_from_ms(ms: float) -> str:
    return _dt.datetime.fromtimestamp(ms / 1000.0, tz=_dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _default_run_id() -> str:
    stamp = _dt.datetime.now(tz=_dt.timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"run_{stamp}"


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9_-]+", "-", s)
    s = s.strip("-")
    return s or "unknown"


def _safe_version(pkg: str, default: str) -> str:
    try:
        from importlib.metadata import version as _v

        return _v(pkg)
    except Exception:
        return default
