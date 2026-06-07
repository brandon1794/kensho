"""Public API for ``kensho-pytest``.

Most of the time you don't import anything — installing the package is
enough; pytest discovers the plugin via the ``pytest11`` entry point and
the reporter writes ``kensho-results/`` automatically.

The helpers exported here are for tests that want to add structured
metadata at runtime:

* :func:`step`   — context manager, opens a Kensho step.
* :func:`attach` — register a file (screenshot, log, JSON dump, …).
* :func:`label`  — attach an arbitrary string ``key=value`` to the case.
* :func:`link`   — attach a hyperlink (Jira ticket, runbook, PR, …).

All four helpers are no-ops when called outside a running test (e.g.
during collection or in a non-pytest script), so it's safe to call them
from helper modules used from both prod and test code.
"""

from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional, Union

from . import _state

__all__ = ["step", "attach", "label", "link", "current_case_id"]

__version__ = "0.1.0"


@contextmanager
def step(title: str, *, action: Optional[str] = None) -> Iterator[Dict[str, Any]]:
    """Context manager that opens a Kensho step.

    Steps can nest — the innermost ``with kensho.step(...)`` becomes the
    parent of any further steps opened inside it. If the ``with`` block
    raises, the step is marked ``fail`` and re-raised.

    Example::

        from kensho_pytest import step

        def test_login(page):
            with step("open the login page"):
                page.goto("/login")
            with step("submit credentials"):
                page.fill("#user", "demo")
                page.fill("#pwd", "demo")
                page.click("text=Sign in")

    Outside a pytest run the call is a no-op — the test code remains
    safe to run as a plain script.
    """
    scratch = _state.get_current()
    if scratch is None:
        # No active test — yield a dummy dict so callers can still write
        # to it without surprising errors.
        yield {}
        return

    started_perf = time.time()
    started_iso = _iso_now()
    step_obj: Dict[str, Any] = {
        "id": "step_" + uuid.uuid4().hex[:10],
        "title": str(title),
        "status": "pass",
        "startedAt": started_iso,
        "duration": 0,
        "_startedPerf": started_perf,
    }
    if action:
        step_obj["action"] = str(action)

    parent = scratch.step_stack[-1] if scratch.step_stack else None
    if parent is not None:
        parent.setdefault("children", []).append(step_obj)
    else:
        scratch.steps.append(step_obj)
    scratch.step_stack.append(step_obj)

    try:
        yield step_obj
    except Exception:
        step_obj["status"] = "fail"
        _close_step(step_obj)
        # pop and re-raise — the test framework decides what to do.
        if scratch.step_stack and scratch.step_stack[-1] is step_obj:
            scratch.step_stack.pop()
        raise
    else:
        _close_step(step_obj)
        if scratch.step_stack and scratch.step_stack[-1] is step_obj:
            scratch.step_stack.pop()


def attach(
    path: Union[str, Path],
    *,
    kind: Optional[str] = None,
    name: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Copy a file into ``kensho-results/attachments/<caseId>/`` and register it.

    Parameters
    ----------
    path:
        Local path to the file to attach. Must exist; missing files are
        skipped with a warning so a flaky screenshot can't break the run.
    kind:
        Optional override for ``attachment.kind``. One of ``screenshot``,
        ``video``, ``trace``, ``har``, ``text``, ``json``, ``html``,
        ``dom-snapshot``, ``log``. Inferred from the file extension when
        omitted.
    name:
        Optional rename for the destination file. Defaults to the source
        basename, prefixed with a short id to dodge collisions.
    mime_type:
        Optional MIME type override. Inferred from the file extension
        when omitted.

    Returns the registered attachment dict, or ``None`` if no test is
    currently active (e.g. when called outside a pytest run).
    """
    scratch = _state.get_current()
    if scratch is None:
        return None
    plugin = _resolve_plugin()
    if plugin is None:
        return None
    record = plugin.register_attachment(
        scratch,
        Path(str(path)),
        kind=kind,
        name=name,
        mime_type=mime_type,
    )
    if record is None:
        return None
    # Anchor it on the innermost step if one is open, otherwise on the case.
    if scratch.step_stack:
        scratch.step_stack[-1].setdefault("attachments", []).append(record)
    else:
        scratch.attachments.append(record)
    return record


def label(key: str, value: str) -> None:
    """Set ``case.labels[key] = value`` for the currently-running test.

    Useful for free-form metadata (``service``, ``team``, ``env``) that
    doesn't fit the typed fields. No-op outside a test."""
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
    """Attach a link to the currently-running case.

    ``kind`` is free-form by convention (``jira``, ``github``, ``runbook``…).
    ``label_text`` becomes ``link.label`` — the human-readable text. The
    parameter is named ``label_text`` rather than ``label`` to avoid
    shadowing the :func:`label` helper.
    """
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
    """Return the stable id of the test currently being run, if any."""
    scratch = _state.get_current()
    return scratch.case_id if scratch is not None else None


# --------------------------------------------------------------------------- #
# Internals
# --------------------------------------------------------------------------- #


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


def _resolve_plugin() -> Any:
    """Return the active ``KenshoPlugin`` instance, or ``None`` if there is none.

    The plugin publishes itself into ``_state.PLUGIN`` during
    ``pytest_configure`` so helper APIs can find it without importing
    the heavy plugin module at startup time.
    """
    return getattr(_state, "PLUGIN", None)
