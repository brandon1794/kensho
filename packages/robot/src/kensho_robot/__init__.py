"""Public API for ``kensho-robot``.

Most of the time you don't import anything — registering the listener with
``robot --listener kensho_robot.Listener tests/`` is enough; the listener
captures Robot's keyword tree, tags, and metadata and writes
``kensho-results/`` automatically.

The helpers exported here are for tests/keywords that want to add structured
metadata at runtime, mirroring the ``kensho_pytest`` API:

* :func:`step`   — context manager, opens a Kensho user step *underneath*
  the current keyword. Most users won't need this — every Robot keyword is
  already a Kensho step. Use it inside a Python library when a single
  keyword does multiple discrete things you'd like to surface.
* :func:`attach` — register a file (screenshot, log, JSON dump, …).
* :func:`label`  — attach an arbitrary string ``key=value`` to the case.
* :func:`link`   — attach a hyperlink (Jira ticket, runbook, PR, …).

All four helpers are no-ops when called outside a running test, so it's
safe to call them from helper modules used from both prod and test code.
"""

from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional, Union

from . import _state
from ._schema import SEVERITY as _SEVERITY
from .listener import Listener  # re-export for `--listener kensho_robot.Listener`

__all__ = [
    "step",
    "attach",
    "label",
    "link",
    "current_case_id",
    "Listener",
    "kensho",
    "Kensho",
    "epic",
    "feature",
    "story",
    "severity",
    "owner",
    "description",
    "tag",
    "jira_link",
    "reference_link",
    "parameter",
    "flaky",
    "muted",
    "known_issue",
]

__version__ = "0.1.0"


@contextmanager
def step(title: str, *, action: Optional[str] = None) -> Iterator[Dict[str, Any]]:
    """Context manager that opens a Kensho step inside the current keyword.

    Steps can nest. If the ``with`` block raises, the step is marked
    ``fail`` and re-raised. Outside a Robot run the call is a no-op.
    """
    scratch = _state.get_current()
    if scratch is None:
        yield {}
        return

    started_perf = time.time()
    started_iso = _iso_now()
    step_obj: Dict[str, Any] = {
        "id": "step_user_" + uuid.uuid4().hex[:10],
        "title": str(title),
        "status": "pass",
        "startedAt": started_iso,
        "duration": 0,
        "phase": "body",
        "_startedPerf": started_perf,
        "_kind": "user",
    }
    if action:
        step_obj["action"] = str(action)

    parent = scratch.user_step_stack[-1] if scratch.user_step_stack else None
    if parent is not None:
        parent.setdefault("children", []).append(step_obj)
    else:
        scratch.user_steps.append(step_obj)
    scratch.user_step_stack.append(step_obj)

    try:
        yield step_obj
    except Exception:
        step_obj["status"] = "fail"
        _close_step(step_obj)
        if scratch.user_step_stack and scratch.user_step_stack[-1] is step_obj:
            scratch.user_step_stack.pop()
        raise
    else:
        _close_step(step_obj)
        if scratch.user_step_stack and scratch.user_step_stack[-1] is step_obj:
            scratch.user_step_stack.pop()


def attach(
    path: Union[str, Path],
    *,
    kind: Optional[str] = None,
    name: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Copy a file into ``kensho-results/attachments/<caseId>/`` and register it.

    Parameters mirror :func:`kensho_pytest.attach`. Returns the attachment
    dict or ``None`` if no test is currently active.
    """
    scratch = _state.get_current()
    if scratch is None:
        return None
    listener = _resolve_listener()
    if listener is None:
        return None
    record = listener.register_attachment(
        scratch,
        Path(str(path)),
        kind=kind,
        name=name,
        mime_type=mime_type,
    )
    if record is None:
        return None
    if scratch.user_step_stack:
        scratch.user_step_stack[-1].setdefault("attachments", []).append(record)
    else:
        scratch.attachments.append(record)
    return record


def label(key: str, value: str) -> None:
    """Set ``case.labels[key] = value`` for the currently-running test."""
    scratch = _state.get_current()
    if scratch is None or not key:
        return
    scratch.labels[str(key)] = str(value)


def link(
    url: str,
    *,
    kind: Optional[str] = None,
    label_text: Optional[str] = None,
) -> None:
    """Attach a link to the currently-running case."""
    scratch = _state.get_current()
    if scratch is None or not url:
        return
    entry: Dict[str, str] = {"url": str(url)}
    if kind:
        entry["kind"] = str(kind)
    if label_text:
        entry["label"] = str(label_text)
    scratch.links.append(entry)


def current_case_id() -> Optional[str]:
    """Return the stable id of the test currently being run, or ``None``."""
    scratch = _state.get_current()
    return scratch.case_id if scratch is not None else None


def _close_step(step_obj: Dict[str, Any]) -> None:
    started_perf = step_obj.pop("_startedPerf", None)
    if started_perf is None:
        step_obj.setdefault("duration", 0)
        return
    step_obj["duration"] = max(0, int(round((time.time() - started_perf) * 1000)))


def _iso_now() -> str:
    import datetime as _dt

    return (
        _dt.datetime.now(tz=_dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _resolve_listener() -> Any:
    return getattr(_state, "LISTENER", None)


# --------------------------------------------------------------------------- #
# Runtime annotation facade
# --------------------------------------------------------------------------- #
#
# Mirrors ``kensho_pytest``'s ``kensho`` facade. Call from a Python library
# imported by your Robot suite (e.g. inside a custom keyword). Every method is
# a no-op outside an active test. Values set here win over anything derived
# from Robot tags / [Documentation] when the case is finalized.


def _runtime_set(key: str, value: Any) -> None:
    scratch = _state.get_current()
    if scratch is None:
        return
    scratch.runtime[key] = value


def epic(name: str) -> None:
    """Set ``case.behavior.epic`` (also mirrored to ``case.labels['epic']``)."""
    if name:
        _runtime_set("epic", str(name))


def feature(name: str) -> None:
    """Set ``case.behavior.feature`` (also mirrored to ``case.labels['feature']``)."""
    if name:
        _runtime_set("feature", str(name))


def story(name: str) -> None:
    """Set ``case.behavior.scenario`` (also mirrored to ``case.labels['story']``)."""
    if name:
        _runtime_set("story", str(name))


def severity(level: str) -> None:
    """Set ``case.severity``. Unknown values are ignored.

    Valid: ``blocker | critical | normal | minor | trivial``.
    """
    if isinstance(level, str) and level.lower() in _SEVERITY:
        _runtime_set("severity", level.lower())


def owner(name: str) -> None:
    """Set ``case.owner``."""
    if name:
        _runtime_set("owner", str(name))


def description(text: str) -> None:
    """Set ``case.description``."""
    if text:
        _runtime_set("description", str(text))


def tag(*tags: str) -> None:
    """Append one or more tags to ``case.tags`` (strip ``@``, de-dupe)."""
    scratch = _state.get_current()
    if scratch is None:
        return
    bag = scratch.runtime.setdefault("tags", [])
    for raw in tags:
        if raw is None:
            continue
        t = str(raw).lstrip("@").strip()
        if t and t not in bag:
            bag.append(t)


def parameter(name: str, value: Any) -> None:
    """Append ``{name, value}`` to ``case.parameters`` (no ``kind``)."""
    scratch = _state.get_current()
    if scratch is None or not name:
        return
    scratch.parameters.append({"name": str(name), "value": _stringify_param(value)})


def link_(url: str, name: Optional[str] = None) -> None:
    """Attach a generic link (``kind='link'``) to the current case."""
    if url:
        _append_link(str(url), kind="link", label_text=name)


def jira_link(id_or_url: str, label: Optional[str] = None) -> None:
    """Attach an ``issue`` link. ``id_or_url`` may be a Jira id or full URL."""
    if not id_or_url:
        return
    _append_link(str(id_or_url), kind="issue", label_text=label or str(id_or_url))


def reference_link(url: str, label: Optional[str] = None) -> None:
    """Attach a ``reference`` link (design doc, runbook, spec…)."""
    if not url:
        return
    _append_link(str(url), kind="reference", label_text=label)


def flaky() -> None:
    """Mark the current test as flaky (``case.flaky = True``)."""
    scratch = _state.get_current()
    if scratch is not None:
        scratch.flaky = True


def muted() -> None:
    """Mark the current test as muted (``case.muted = True``)."""
    scratch = _state.get_current()
    if scratch is not None:
        scratch.muted = True


def known_issue(id_or_url: str, label: Optional[str] = None) -> None:
    """Mark the test muted and attach an ``issue`` link for the ticket."""
    scratch = _state.get_current()
    if scratch is None:
        return
    scratch.muted = True
    if id_or_url:
        _append_link(str(id_or_url), kind="issue", label_text=label or str(id_or_url))


def _append_link(url: str, *, kind: Optional[str], label_text: Optional[str]) -> None:
    scratch = _state.get_current()
    if scratch is None or not url:
        return
    entry: Dict[str, str] = {"url": str(url)}
    if kind:
        entry["kind"] = str(kind)
    if label_text:
        entry["label"] = str(label_text)
    scratch.links.append(entry)


def _stringify_param(v: Any) -> str:
    if isinstance(v, str):
        return v
    try:
        return str(v)
    except Exception:
        return "<unstr>"


class Kensho:
    """Namespaced runtime annotation facade (mirrors ``kensho_pytest``)."""

    epic = staticmethod(epic)
    feature = staticmethod(feature)
    story = staticmethod(story)
    severity = staticmethod(severity)
    owner = staticmethod(owner)
    description = staticmethod(description)
    tag = staticmethod(tag)
    label = staticmethod(label)
    parameter = staticmethod(parameter)
    link = staticmethod(link_)
    jira_link = staticmethod(jira_link)
    reference_link = staticmethod(reference_link)
    step = staticmethod(step)
    attach = staticmethod(attach)
    flaky = staticmethod(flaky)
    muted = staticmethod(muted)
    known_issue = staticmethod(known_issue)
    current_case_id = staticmethod(current_case_id)


kensho = Kensho()
