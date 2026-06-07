"""End-to-end demo for kensho-pytest.

Covers the full feature surface so the generated kensho-results/ has
something interesting to render:

* pass / fail / skip / xfail / parametrize
* severity, feature, epic, story, owner, description, tags
* arbitrary kensho_label / kensho_link
* nested kensho.step blocks
* attachments (text + screenshot fixture)
* captured stdout/stderr -> logs
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

import kensho_pytest as kensho

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@pytest.mark.critical
@pytest.mark.feature("Authentication")
@pytest.mark.epic("User onboarding")
@pytest.mark.owner("alice")
@pytest.mark.description("Login with valid credentials lands the user on /home.")
@pytest.mark.kensho_label(team="growth", surface="web")
@pytest.mark.kensho_link(kind="jira", url="https://jira.example.com/browse/PROJ-123",
                        label="PROJ-123")
def test_login_happy_path():
    print("about to call backend")  # captured -> logs[]
    with kensho.step("open the login page"):
        with kensho.step("warm up CDN"):
            assert 1 + 1 == 2
    with kensho.step("submit credentials"):
        kensho.label("traffic", "synthetic")
        assert "ok" == "ok"
    kensho.attach(FIXTURES / "session.txt", kind="text",
                  name="session-dump.txt")


@pytest.mark.severity("blocker")
@pytest.mark.feature("Cart")
def test_cart_total_is_wrong():
    """A failing test — should map to status='fail'."""
    print("computing cart total")
    sys.stderr.write("warn: stale price cache\n")
    with kensho.step("load cart fixture"):
        cart = {"items": [{"price": 10}, {"price": 20}]}
    with kensho.step("verify total"):
        kensho.attach(FIXTURES / "broken-cart.png", kind="screenshot")
        # Intentional failure — sums to 30 not 40.
        assert sum(i["price"] for i in cart["items"]) == 40, "cart total mismatch"


@pytest.mark.minor
@pytest.mark.skip(reason="feature not enabled in this environment")
def test_promo_codes_skipped():
    pass  # pragma: no cover


@pytest.mark.normal
@pytest.mark.feature("Search")
@pytest.mark.parametrize(
    "query, expected_count",
    [
        ("widgets", 3),
        ("gadgets", 5),
        ("doodads", 0),
    ],
    ids=["common", "rare", "empty"],
)
def test_search_returns_expected_count(query, expected_count):
    fake_db = {"widgets": 3, "gadgets": 5, "doodads": 0}
    with kensho.step(f"query={query!r}"):
        assert fake_db[query] == expected_count


@pytest.mark.feature("Profile")
class TestProfile:
    @pytest.mark.normal
    def test_avatar_upload(self):
        with kensho.step("pick avatar"):
            pass
        with kensho.step("upload"):
            pass

    @pytest.mark.trivial
    def test_change_email(self):
        kensho.link("https://github.com/example/app/pull/42", kind="github",
                    label_text="PR #42")
        with kensho.step("update email"):
            pass


@pytest.mark.normal
def test_setup_failure(tmp_path, request):
    """Force an error in a fixture-like setup path -> should map to broken.

    We can't easily inject a real setup failure without a fixture, so this
    test simply demonstrates a teardown-style assertion. Real setup
    failures (e.g. fixture errors) are exercised through pytest's own
    machinery in the kensho-pytest test suite.
    """
    with kensho.step("a passing step"):
        assert tmp_path.exists()


@pytest.mark.normal
@pytest.mark.xfail(reason="known broken integration")
def test_xfail_demo():
    assert False  # noqa: B011  # marked xfail -> still a pass for kensho


@pytest.mark.normal
def test_logs_only():
    """Verify captured output is forwarded into case.logs."""
    print("hello from stdout")
    print("more output")
    sys.stderr.write("uh oh from stderr\n")
