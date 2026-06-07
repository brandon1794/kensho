"""Tiny Robot library used by the kensho-robot demo.

Wraps a couple of `kensho_robot` helpers as Robot keywords so the example
suite can exercise the Python-side helper API without inlining Python in
each `*.robot` file.
"""

from pathlib import Path

import kensho_robot as kensho


def attach_fixture(path: str, kind: str = None, name: str = None) -> None:
    """Wrap kensho.attach so it can be called from Robot."""
    kensho.attach(path, kind=kind, name=name)


def get_demo_fixtures_dir() -> str:
    return str((Path(__file__).resolve().parent.parent / "fixtures").as_posix())


def kensho_label(key: str, value: str) -> None:
    kensho.label(key, value)


def kensho_link(url: str, kind: str = None, label: str = None) -> None:
    kensho.link(url, kind=kind, label_text=label)
