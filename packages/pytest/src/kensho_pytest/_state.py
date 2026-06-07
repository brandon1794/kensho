"""Per-test mutable state used by helper APIs.

The plugin sets ``CURRENT_CASE`` at the start of each test's setup phase
and clears it at the end of teardown. While a test is running, the
:func:`kensho_pytest.step`, :func:`kensho_pytest.attach`,
:func:`kensho_pytest.label`, and :func:`kensho_pytest.link` helpers mutate
this object directly so the plugin can pick up the data when it finalizes
the case.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional


class CaseScratch:
    """Mutable per-test scratch space.

    The plugin owns one of these per running test. Helpers append to the
    public lists; the plugin reads them at ``logfinish`` time and merges
    them into the final case JSON.
    """

    __slots__ = (
        "case_id",
        "nodeid",
        "started_at_ms",
        "steps",
        "step_stack",
        "attachments",
        "logs",
        "labels",
        "links",
    )

    def __init__(self, case_id: str, nodeid: str, started_at_ms: float) -> None:
        self.case_id: str = case_id
        self.nodeid: str = nodeid
        self.started_at_ms: float = started_at_ms
        # Top-level steps (children nest via the step stack).
        self.steps: List[Dict[str, Any]] = []
        # Stack of currently-open step dicts; the innermost is .top.
        self.step_stack: List[Dict[str, Any]] = []
        self.attachments: List[Dict[str, Any]] = []
        self.logs: List[Dict[str, Any]] = []
        self.labels: Dict[str, str] = {}
        self.links: List[Dict[str, str]] = []


# Threading note: pytest-xdist runs each worker in its own process, so a
# plain module-level slot is fine for the common case. We still guard with
# a lock so threaded fixtures (rare but possible) don't race the helpers.
_lock = threading.Lock()
_current: Optional[CaseScratch] = None

# Set by ``pytest_configure`` so the public helper API can find the running
# plugin without round-tripping through pytest's config singleton.
PLUGIN: Optional[Any] = None  # type: ignore[assignment]


def set_current(scratch: Optional[CaseScratch]) -> None:
    global _current
    with _lock:
        _current = scratch


def get_current() -> Optional[CaseScratch]:
    return _current


def set_plugin(plugin: Optional[Any]) -> None:
    global PLUGIN
    PLUGIN = plugin
