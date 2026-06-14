"""Unit tests for GoogleIntegration's OAuth verifier threading.

The PKCE code_verifier generated when building the authorization URL MUST be
carried to the token exchange, or Google rejects the callback with
"Missing code verifier". These tests pin that contract without any network.
"""

from __future__ import annotations

import weekforge.integration as integ
from weekforge.integration import GoogleIntegration


class _FakeStore:
    def __init__(self) -> None:
        self.saved: dict | None = None

    def save(self, credentials: dict) -> None:
        self.saved = credentials

    def load(self) -> dict | None:
        return self.saved

    def clear(self) -> None:
        self.saved = None


def test_login_url_stores_verifier_and_complete_login_passes_it(monkeypatch):
    captured: dict = {}

    def fake_build_authorization_url():
        return ("https://auth.example/url", "state-xyz", "VERIFIER-123")

    def fake_exchange_code(code: str, code_verifier=None) -> dict:
        captured["code"] = code
        captured["code_verifier"] = code_verifier
        return {"token": "t", "refresh_token": "r"}

    monkeypatch.setattr(integ, "build_authorization_url", fake_build_authorization_url)
    monkeypatch.setattr(integ, "exchange_code", fake_exchange_code)

    store = _FakeStore()
    google = GoogleIntegration(token_store=store)

    url = google.login_url()
    assert url == "https://auth.example/url"

    google.complete_login("auth-code-abc")

    # The verifier from the authorization step must reach the token exchange.
    assert captured["code"] == "auth-code-abc"
    assert captured["code_verifier"] == "VERIFIER-123"
    assert store.saved == {"token": "t", "refresh_token": "r"}


def test_complete_login_clears_pending_verifier_after_use(monkeypatch):
    monkeypatch.setattr(
        integ, "build_authorization_url",
        lambda: ("u", "s", "VERIFIER-123"),
    )
    seen: list = []
    monkeypatch.setattr(
        integ, "exchange_code",
        lambda code, code_verifier=None: seen.append(code_verifier) or {"token": "t"},
    )

    google = GoogleIntegration(token_store=_FakeStore())
    google.login_url()
    google.complete_login("code-1")

    # After use the pending verifier is cleared so a stale value can't leak
    # into an unrelated later exchange.
    assert google._pending_code_verifier is None
    assert seen == ["VERIFIER-123"]
