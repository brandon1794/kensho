"""Per-test mutable state used by helper APIs.

The Listener sets the active scratch on test start and clears it on test
end. While a test is running, :func:`kensho_robot.step`,
:func:`kensho_robot.attach`, :func:`kensho_robot.label`, and
:func:`kensho_robot.link` mutate this object directly so the listener can
pick up the data when it finalizes the case.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional


class CaseScratch:
    """Mutable per-test scratch space owned by the listener."""

    __slots__ = (
        "case_id",
        "robot_id",
        "started_at_ms",
        "user_steps",
        "user_step_stack",
        "attachments",
        "logs",
        "labels",
        "links",
        "parameters",
        "flaky",
        "muted",
        "runtime",
    )

    def __init__(self, case_id: str, robot_id: str, started_at_ms: float) -> None:
        self.case_id: str = case_id
        self.robot_id: str = robot_id
        self.started_at_ms: float = started_at_ms
        # Top-level user-opened steps (children nest via the step stack).
        self.user_steps: List[Dict[str, Any]] = []
        self.user_step_stack: List[Dict[str, Any]] = []
        self.attachments: List[Dict[str, Any]] = []
        self.logs: List[Dict[str, Any]] = []
        self.labels: Dict[str, str] = {}
        self.links: List[Dict[str, str]] = []
        self.parameters: List[Dict[str, str]] = []
        # Markers (flaky() / muted() / known_issue()).
        self.flaky: bool = False
        self.muted: bool = False
        # Runtime overrides set via the ``kensho`` facade. These win over
        # static tags when the case is finalized. Keys: severity, owner,
        # description, epic, feature, scenario. Plus ``tags`` (list, appended).
        self.runtime: Dict[str, Any] = {}


_lock = threading.Lock()
_current: Optional[CaseScratch] = None

# Set by the listener so the helper API can find the running listener
# without round-tripping through Robot's internals.
LISTENER: Optional[Any] = None  # type: ignore[assignment]


def set_current(scratch: Optional[CaseScratch]) -> None:
    global _current
    with _lock:
        _current = scratch


def get_current() -> Optional[CaseScratch]:
    return _current


def set_listener(listener: Optional[Any]) -> None:
    global LISTENER
    LISTENER = listener
