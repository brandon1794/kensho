"""Robot Framework Listener v3 implementation that emits Kensho v1 result bundles.

Layout written under the configured ``output`` directory (default
``kensho-results``)::

    kensho-results/
      run.json                 manifest (project, env, totals, framework, timing)
      cases/<stableId>.json    one file per test case
      attachments/<caseId>/    files registered via ``kensho_robot.attach``

Hook flow:

* ``start_suite``     remember suite metadata (Documentation, Force Tags) for
                      tests that inherit them.
* ``start_test``      open a per-test scratch for the helpers.
* ``start_keyword``   push a Kensho step onto the stack for each keyword
                      (BUILTIN, LIBRARY, USER KEYWORD, SETUP, TEARDOWN, etc.).
* ``log_message``     forward Robot's ``Log`` messages into the active
                      step's ``logs[]``.
* ``end_keyword``     close the step, set status + duration.
* ``end_test``        finalize the case; write ``cases/<id>.json``.
* ``end_suite``       (top-level) write ``run.json``.

The listener never raises out of a hook — a broken adapter must not break a
test run. All errors come out as ``warnings.warn``.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import shutil
import sys
import time
import uuid
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import _state
from ._schema import (
    SCHEMA_VERSION,
    SEVERITY,
    env_info,
    kind_and_mime_for,
    stable_case_id,
)
from ._state import CaseScratch


_SEVERITY_ALIASES = set(SEVERITY)
_SEVERITY_TAG_RE = re.compile(r"^@?(?:severity[:=])?(blocker|critical|normal|minor|trivial)$", re.IGNORECASE)


class Listener:
    """Robot Framework Listener v3 that writes Kensho v1 results.

    Register on the command line::

        robot --listener kensho_robot.Listener tests/

    Pass options after a colon::

        robot --listener kensho_robot.Listener:output=kensho-results:project_name=Demo tests/
    """

    ROBOT_LISTENER_API_VERSION = 3

    def __init__(
        self,
        output: str = "kensho-results",
        project_name: str = "Unknown project",
        project_slug: Optional[str] = None,
        run_id: Optional[str] = None,
        severity_from_tags: str = "true",
    ) -> None:
        self.output_dir = Path(output).resolve()
        self.cases_dir = self.output_dir / "cases"
        self.attachments_dir = self.output_dir / "attachments"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.cases_dir.mkdir(parents=True, exist_ok=True)
        self.attachments_dir.mkdir(parents=True, exist_ok=True)

        self.project = {
            "name": project_name,
            "slug": project_slug or _slugify(project_name),
        }
        self.run_id = run_id or _default_run_id()
        self.severity_from_tags = _coerce_bool(severity_from_tags)

        # Robot reads/writes file paths as strings; we resolve everything
        # relative to the current working directory at listener-start time so
        # ``filePath`` lines up across runs.
        try:
            self._rootpath = Path.cwd().resolve()
        except OSError:
            self._rootpath = Path("/")

        self._started_perf = time.time()
        self._started_iso = _now_iso()
        self._cases_by_id: Dict[str, Dict[str, Any]] = {}
        self._ids_seen: Dict[str, int] = {}

        # Stack of suites currently entered; the deepest is the test's
        # immediate parent. Each entry: (name, doc, tags, source).
        self._suite_stack: List[Tuple[str, Optional[str], List[str], Optional[str]]] = []

        # Per-test scratch — kept on the listener so the helper API can
        # discover it without going through Robot's internals.
        self._scratch: Optional[CaseScratch] = None
        # Stack of keyword-derived Kensho steps currently open. The top is the
        # innermost keyword. Each step lives at one of three places: the case's
        # top-level steps list, a parent keyword step's children, or — when a
        # user-opened ``kensho.step`` is on top — that user step's children.
        self._kw_stack: List[Dict[str, Any]] = []
        # Pre-built skeleton for the current case so end_test can fill in the
        # status/duration without re-deriving everything.
        self._current_case: Optional[Dict[str, Any]] = None
        self._current_data: Any = None

        _state.set_listener(self)

    # ----- suite hooks ----- #

    def start_suite(self, data: Any, result: Any) -> None:  # noqa: ARG002
        try:
            tags = list(getattr(data, "tags", None) or [])
            doc = getattr(data, "doc", None) or None
            source = getattr(data, "source", None)
            self._suite_stack.append((str(getattr(data, "name", "") or ""), doc, tags, str(source) if source else None))
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho-robot] start_suite: {exc}", stacklevel=2)

    def end_suite(self, data: Any, result: Any) -> None:  # noqa: ARG002
        try:
            if self._suite_stack:
                self._suite_stack.pop()
            # Top-level end_suite — flush run.json.
            if not self._suite_stack:
                self._write_run_json()
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho-robot] end_suite: {exc}", stacklevel=2)

    # ----- test hooks ----- #

    def start_test(self, data: Any, result: Any) -> None:  # noqa: ARG002
        try:
            self._open_case(data)
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho-robot] start_test: {exc}", stacklevel=2)

    def end_test(self, data: Any, result: Any) -> None:
        try:
            self._close_case(data, result)
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho-robot] end_test: {exc}", stacklevel=2)
        finally:
            _state.set_current(None)
            self._scratch = None
            self._current_case = None
            self._current_data = None
            self._kw_stack.clear()

    # ----- keyword hooks ----- #

    def start_keyword(self, data: Any, result: Any) -> None:
        if self._current_case is None:
            return
        try:
            kw_type = str(getattr(result, "type", "KEYWORD") or "KEYWORD").lower()
            phase = (
                "setup" if kw_type in ("setup", "suite_setup")
                else "teardown" if kw_type in ("teardown", "suite_teardown")
                else "body"
            )
            title = str(getattr(result, "name", "") or getattr(data, "name", "") or "(keyword)")
            owner = getattr(result, "owner", None) or getattr(result, "libname", None)
            full_title = f"{owner}.{title}" if owner else title

            args = getattr(result, "args", None) or []
            try:
                args_repr = ", ".join(str(a) for a in args)
            except Exception:
                args_repr = ""
            target = args_repr if args_repr else None

            # Library / Resource calls and user keywords roll up children, so
            # mark them as "group" via action="group" so the viewer knows.
            kind = "group" if kw_type in ("keyword", "setup", "teardown") else kw_type

            step: Dict[str, Any] = {
                "id": "step_kw_" + uuid.uuid4().hex[:10],
                "title": full_title,
                "action": kind,
                "status": "pass",  # overwritten in end_keyword
                "startedAt": _iso_from_robot(getattr(result, "start_time", None)) or _now_iso(),
                "duration": 0,
                "phase": phase,
                "_startedPerf": time.time(),
            }
            if target:
                step["target"] = target

            # Anchor the step under either the most recent user-opened step,
            # the most recent keyword step, or the case's top-level steps.
            scratch = self._scratch
            parent_user = scratch.user_step_stack[-1] if (scratch and scratch.user_step_stack) else None
            parent_kw = self._kw_stack[-1] if self._kw_stack else None
            if parent_user is not None:
                parent_user.setdefault("children", []).append(step)
            elif parent_kw is not None:
                parent_kw.setdefault("children", []).append(step)
            else:
                self._current_case.setdefault("steps", []).append(step)
            self._kw_stack.append(step)
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho-robot] start_keyword: {exc}", stacklevel=2)

    def end_keyword(self, data: Any, result: Any) -> None:  # noqa: ARG002
        if not self._kw_stack:
            return
        try:
            step = self._kw_stack.pop()
            status = _map_step_status(getattr(result, "status", "PASS"))
            step["status"] = status
            started_perf = step.pop("_startedPerf", None)
            duration = _duration_ms(getattr(result, "elapsed_time", None))
            if duration is None and started_perf is not None:
                duration = max(0, int(round((time.time() - started_perf) * 1000)))
            step["duration"] = duration or 0

            msg = str(getattr(result, "message", "") or "")
            if status == "fail" and msg:
                step.setdefault("assertion", {})
                step["assertion"]["stack"] = msg
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho-robot] end_keyword: {exc}", stacklevel=2)

    # ----- log hooks ----- #

    def log_message(self, message: Any) -> None:
        if self._scratch is None:
            return
        try:
            level = _map_log_level(getattr(message, "level", "INFO"))
            text = str(getattr(message, "message", "") or "")
            if not text:
                return
            t = max(0, int(round((time.time() * 1000.0) - self._scratch.started_at_ms)))
            entry = {"t": t, "level": level, "msg": text}
            # Anchor on the innermost open step if any, else on the case logs.
            target = (
                self._kw_stack[-1] if self._kw_stack
                else (self._scratch.user_step_stack[-1] if self._scratch.user_step_stack else None)
            )
            if target is not None:
                target.setdefault("logs", []).append(entry)
            else:
                self._scratch.logs.append(entry)
        except Exception as exc:  # pragma: no cover — defensive
            warnings.warn(f"[kensho-robot] log_message: {exc}", stacklevel=2)

    # ----- output hooks ----- #

    def output_file(self, path: Any) -> None:  # noqa: ARG002
        # We don't need Robot's output.xml — we've been streaming straight
        # into our own bundle. Implemented purely so the v3 listener
        # contract is satisfied.
        pass

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
            warnings.warn(f"[kensho-robot] attachment not found: {src}", stacklevel=3)
            return None
        attachments_root = self.attachments_dir / case.case_id
        attachments_root.mkdir(parents=True, exist_ok=True)
        att_id = "att_" + uuid.uuid4().hex[:8]
        dest_name = name or src.name
        dest = attachments_root / f"{att_id}_{dest_name}"
        try:
            shutil.copyfile(src, dest)
        except OSError as exc:
            warnings.warn(f"[kensho-robot] failed to copy {src}: {exc}", stacklevel=3)
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

    # ----- internals ----- #

    def _open_case(self, data: Any) -> None:
        full_name = str(getattr(data, "longname", None) or getattr(data, "full_name", None) or getattr(data, "name", "") or "")
        name = str(getattr(data, "name", "") or full_name)
        source = getattr(data, "source", None)
        file_path = self._rel_path(source) if source else None
        line = getattr(data, "lineno", None)

        suite = self._suite_chain_names()

        base_id = stable_case_id(full_name, file_path)
        seen = self._ids_seen.get(base_id, 0)
        case_id = base_id if seen == 0 else f"{base_id}_{seen + 1}"
        self._ids_seen[base_id] = seen + 1

        tags = list(getattr(data, "tags", None) or [])

        severity = None
        if self.severity_from_tags:
            severity = _severity_from_tags(tags)

        labels: Dict[str, str] = {}
        links: List[Dict[str, str]] = []
        owner: Optional[str] = None
        feature: Optional[str] = None
        epic: Optional[str] = None
        scenario: Optional[str] = None
        clean_tags: List[str] = []

        for tag in tags:
            t = str(tag)
            # @severity:critical / @critical → handled above
            if _SEVERITY_TAG_RE.match(t):
                continue
            # @owner:alice → case.owner
            if t.lower().startswith("@owner:") or t.lower().startswith("owner:"):
                owner = t.split(":", 1)[1]
                continue
            # @feature:Auth / @epic:Onboarding / @scenario:HappyPath
            if t.lower().startswith(("@feature:", "feature:")):
                feature = t.split(":", 1)[1]
                continue
            if t.lower().startswith(("@epic:", "epic:")):
                epic = t.split(":", 1)[1]
                continue
            if t.lower().startswith(("@scenario:", "scenario:", "@story:", "story:")):
                scenario = t.split(":", 1)[1]
                continue
            # @label:key=value → case.labels
            if t.lower().startswith(("@label:", "label:")):
                kv = t.split(":", 1)[1]
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    labels[k.strip()] = v.strip()
                continue
            # @link:url or @link:kind=url=label
            if t.lower().startswith(("@link:", "link:")):
                rest = t.split(":", 1)[1]
                links.append(_parse_link_tag(rest))
                continue
            clean_tags.append(t.lstrip("@") if t.startswith("@") else t)

        # Suite documentation surfaces as behavior.feature unless a specific
        # @feature: tag overrode it. Use the first line only — Robot's
        # `Documentation    Long ...    Multi-line ...` text is verbose and
        # the feature chip should stay short.
        if not feature:
            for sname, sdoc, _, _ in reversed(self._suite_stack):
                if sdoc:
                    first = sdoc.splitlines()[0].strip().rstrip(",;:")
                    # Keep it concise — anything longer than ~60 chars is
                    # almost certainly free-form docs, not a feature name.
                    if 0 < len(first) <= 60:
                        feature = first
                    break

        # Test [Documentation] → description
        description = getattr(data, "doc", None) or None

        # [Template] data-driven tests: Robot folds args into the keyword
        # body so each row's arguments are visible there. We surface the
        # template name in `case.parameters`.
        template = getattr(data, "template", None)

        case: Dict[str, Any] = {
            "id": case_id,
            "name": name,
            "fullName": full_name,
            "filePath": file_path,
            "suite": suite,
            "tags": clean_tags,
            "status": "skip",  # overwritten in end_test
            "startedAt": self._started_iso,
            "duration": 0,
            "retries": 0,
            "platform": _platform_str(),
        }
        if line is not None:
            case["line"] = int(line)
        if severity:
            case["severity"] = severity
        if owner:
            case["owner"] = owner
        if labels:
            case["labels"] = labels
        if links:
            case["links"] = links
        behavior: Dict[str, str] = {}
        if epic:
            behavior["epic"] = epic
        if feature:
            behavior["feature"] = feature
        if scenario:
            behavior["scenario"] = scenario
        if behavior:
            case["behavior"] = behavior
        if description:
            case["description"] = str(description)
        if template:
            case["parameters"] = [{"name": "template", "value": str(template), "kind": "context"}]

        scratch = CaseScratch(case_id=case_id, robot_id=str(getattr(data, "id", "")), started_at_ms=time.time() * 1000.0)
        self._scratch = scratch
        _state.set_current(scratch)

        self._current_case = case
        self._current_data = data

    def _close_case(self, data: Any, result: Any) -> None:
        case = self._current_case
        scratch = self._scratch
        if case is None or scratch is None:
            return

        status_robot = str(getattr(result, "status", "FAIL") or "FAIL")
        status = _map_status(status_robot, result)
        case["status"] = status

        duration = _duration_ms(getattr(result, "elapsed_time", None))
        if duration is None:
            duration = max(0, int(round(time.time() * 1000.0 - scratch.started_at_ms)))
        case["duration"] = duration
        case["startedAt"] = _iso_from_robot(getattr(result, "start_time", None)) or _iso_from_ms(scratch.started_at_ms)
        case["finishedAt"] = (
            _iso_from_robot(getattr(result, "end_time", None))
            or _iso_from_ms(scratch.started_at_ms + duration)
        )

        message = str(getattr(result, "message", "") or "")
        if status in ("fail", "broken") and message:
            case["errors"] = [{"message": _first_line(message), "stack": message}]

        # Merge user-opened steps after the keyword-derived ones — the helper
        # ones are typically inside a Python library, so they appear under
        # the keyword they belong to via the parent_user code path. The
        # remaining `user_steps` are top-level only when the user opened a
        # step before any keyword started, which is rare; we still surface
        # them to keep the data lossless.
        if scratch.user_steps:
            case.setdefault("steps", []).extend(scratch.user_steps)

        if scratch.attachments:
            case.setdefault("attachments", []).extend(scratch.attachments)
        if scratch.labels:
            case.setdefault("labels", {}).update(scratch.labels)
        if scratch.links:
            case.setdefault("links", []).extend(scratch.links)
        if scratch.logs:
            case.setdefault("logs", []).extend(scratch.logs)

        # Drop empty optional fields that Robot exposes as empty strings.
        for k in ("filePath",):
            if case.get(k) is None:
                case.pop(k, None)
        for k in ("suite", "tags"):
            if k in case and not case[k]:
                del case[k]

        # Strip any leftover internal markers from steps.
        _scrub_steps(case.get("steps") or [])

        path = self.cases_dir / f"{case['id']}.json"
        try:
            path.write_text(json.dumps(case, indent=2), encoding="utf-8")
        except OSError as exc:
            warnings.warn(f"[kensho-robot] could not write {path.name}: {exc}", stacklevel=2)
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
                "name": "robotframework",
                "version": _robot_version(),
            },
            "env": env_info(),
            "startedAt": self._started_iso,
            "finishedAt": finished_at,
            "totals": totals,
            "durationMs": duration_ms,
            "testCases": cases,
        }
        path = self.output_dir / "run.json"
        try:
            path.write_text(json.dumps(run, indent=2), encoding="utf-8")
        except OSError as exc:
            warnings.warn(f"[kensho-robot] could not write run.json: {exc}", stacklevel=2)

    def _suite_chain_names(self) -> List[str]:
        return [n for (n, _doc, _tags, _src) in self._suite_stack if n]

    def _rel_path(self, source: Any) -> Optional[str]:
        try:
            p = Path(str(source)).resolve()
        except Exception:
            return None
        try:
            return str(p.relative_to(self._rootpath).as_posix())
        except ValueError:
            return str(p.as_posix())


# --------------------------------------------------------------------------- #
# Module-level helpers
# --------------------------------------------------------------------------- #


def _coerce_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    return s in ("1", "true", "yes", "on")


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9_-]+", "-", s)
    s = s.strip("-")
    return s or "unknown"


def _default_run_id() -> str:
    stamp = _dt.datetime.now(tz=_dt.timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"run_{stamp}"


def _now_iso() -> str:
    return (
        _dt.datetime.now(tz=_dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _iso_from_ms(ms: float) -> str:
    return (
        _dt.datetime.fromtimestamp(ms / 1000.0, tz=_dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _iso_from_robot(t: Any) -> Optional[str]:
    """Robot 7+ exposes start_time/end_time as datetime objects.

    Older versions still pass the legacy YYYYMMDD-HH:MM:SS.fff string via
    starttime/endtime — we tolerate both shapes.
    """
    if t is None:
        return None
    if isinstance(t, _dt.datetime):
        if t.tzinfo is None:
            t = t.replace(tzinfo=_dt.timezone.utc)
        return t.astimezone(_dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    s = str(t)
    # Legacy: "20240926 16:20:30.123"
    m = re.match(r"^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d+)$", s)
    if m:
        try:
            dt = _dt.datetime(
                int(m.group(1)), int(m.group(2)), int(m.group(3)),
                int(m.group(4)), int(m.group(5)), int(m.group(6)),
                int((m.group(7) + "000000")[:6]), tzinfo=_dt.timezone.utc,
            )
            return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except ValueError:
            return None
    # Try ISO already.
    try:
        dt = _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_dt.timezone.utc)
        return dt.astimezone(_dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except ValueError:
        return None


def _duration_ms(elapsed: Any) -> Optional[int]:
    """Robot 7+ exposes elapsed_time as a timedelta; older versions as ms int."""
    if elapsed is None:
        return None
    if isinstance(elapsed, _dt.timedelta):
        return max(0, int(round(elapsed.total_seconds() * 1000)))
    try:
        return max(0, int(round(float(elapsed))))
    except (TypeError, ValueError):
        return None


def _map_status(status: str, result: Any) -> str:
    s = str(status or "").upper()
    if s == "PASS":
        return "pass"
    if s == "SKIP" or s == "NOT RUN":
        return "skip"
    if s == "FAIL":
        # Heuristic: if a setup or teardown keyword is the source of failure,
        # treat as ``broken`` (infrastructure failure) rather than ``fail``
        # (assertion/test-body failure).
        if _failure_in_fixture(result):
            return "broken"
        return "fail"
    # ERROR / unknown → broken
    return "broken"


def _map_step_status(status: str) -> str:
    s = str(status or "").upper()
    if s == "PASS":
        return "pass"
    if s == "SKIP" or s == "NOT RUN":
        return "skip"
    return "fail"  # The step status enum has no 'broken'.


def _failure_in_fixture(result: Any) -> bool:
    """Return True if the test failed because of a setup or teardown error.

    Robot ≥ 7 always exposes ``.setup`` / ``.teardown`` keyword wrappers, even
    when the test has no explicit ``[Setup]`` / ``[Teardown]``; we have to
    check ``has_setup`` / ``has_teardown`` so a body-only failure isn't
    misclassified as a fixture problem.
    """
    if getattr(result, "has_setup", False):
        st = str(getattr(getattr(result, "setup", None), "status", "") or "").upper()
        if st == "FAIL":
            return True
    if getattr(result, "has_teardown", False):
        st = str(getattr(getattr(result, "teardown", None), "status", "") or "").upper()
        if st == "FAIL":
            return True
    return False


def _map_log_level(level: str) -> str:
    s = str(level or "").upper()
    if s in ("ERROR", "FAIL"):
        return "error"
    if s == "WARN":
        return "warn"
    if s in ("DEBUG", "TRACE"):
        return "debug"
    return "info"


def _severity_from_tags(tags: List[str]) -> Optional[str]:
    for t in tags:
        m = _SEVERITY_TAG_RE.match(str(t))
        if m:
            return m.group(1).lower()
    return None


def _parse_link_tag(spec: str) -> Dict[str, str]:
    """Parse a ``@link:`` tag value.

    Accepts:
      * ``url``                  → ``{url}``
      * ``kind=url``             → ``{kind, url}``
      * ``kind=url=label``       → ``{kind, url, label}``
    """
    parts = spec.split("=")
    if len(parts) == 1:
        return {"url": parts[0]}
    if len(parts) == 2:
        return {"kind": parts[0], "url": parts[1]}
    return {"kind": parts[0], "url": parts[1], "label": "=".join(parts[2:])}


def _scrub_steps(steps: List[Dict[str, Any]]) -> None:
    for s in steps:
        s.pop("_startedPerf", None)
        s.pop("_kind", None)
        if isinstance(s.get("children"), list):
            _scrub_steps(s["children"])


def _first_line(s: str) -> str:
    if not s:
        return ""
    for line in s.splitlines():
        line = line.strip()
        if line:
            return line
    return ""


def _platform_str() -> str:
    p = sys.platform
    if p.startswith("linux"):
        return "linux"
    if p == "darwin":
        return "darwin"
    if p in ("win32", "cygwin"):
        return "win32"
    return p


def _robot_version() -> str:
    try:
        from robot.version import VERSION as _V

        return _V
    except Exception:
        return "0.0.0"
