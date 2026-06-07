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
from .listener import Listener  # re-export for `--listener kensho_robot.Listener`

__all__ = ["step", "attach", "label", "link", "current_case_id", "Listener"]

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
