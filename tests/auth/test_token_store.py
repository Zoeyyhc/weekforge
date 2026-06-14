"""Tests for OAuthTokenStore / JsonFileTokenStore."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from weekforge.auth.token_store import JsonFileTokenStore


def _creds() -> dict:
    return {
        "token": "access-token-abc",
        "refresh_token": "refresh-token-xyz",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "client-id",
        "client_secret": "client-secret",
        "scopes": ["https://www.googleapis.com/auth/calendar"],
    }


def test_save_and_load_round_trip(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    creds = _creds()

    store.save(creds)
    loaded = store.load()

    assert loaded == creds


def test_load_returns_none_when_file_absent(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    assert store.load() is None


def test_save_creates_parent_directories(tmp_path):
    path = tmp_path / "nested" / "dir" / "token.json"
    store = JsonFileTokenStore(path)

    store.save(_creds())

    assert path.exists()


def test_clear_removes_file(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    store.save(_creds())

    store.clear()

    assert store.load() is None


def test_clear_is_idempotent_when_file_absent(tmp_path):
    store = JsonFileTokenStore(tmp_path / "token.json")
    store.clear()  # must not raise


def test_file_content_is_valid_json(tmp_path):
    path = tmp_path / "token.json"
    store = JsonFileTokenStore(path)
    store.save(_creds())

    raw = json.loads(path.read_text())
    assert raw["refresh_token"] == "refresh-token-xyz"
