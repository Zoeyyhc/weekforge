from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from .conftest import MockCouncil
from weekforge.api.app import create_app


@pytest.fixture
def app(tmp_path):
    return create_app(
        council=MockCouncil(),
        api_key="test-key",
        db_path=str(tmp_path / "auth_api.db"),
        auth_secret="test-secret-key-with-32-bytes-min!!",
    )


@pytest.fixture
def raw(app):
    return TestClient(app)


def _signup(raw, email="a@b.com"):
    return raw.post("/auth/signup", json={"email": email, "password": "hunter2", "display_name": "Ada"})


def test_signup_returns_token_and_user(raw):
    resp = _signup(raw)
    assert resp.status_code == 200
    body = resp.json()
    assert body["token"]
    assert body["user"]["email"] == "a@b.com"
    assert body["user"]["display_name"] == "Ada"
    assert "password_hash" not in body["user"]


def test_signup_duplicate_email_conflicts(raw):
    _signup(raw)
    assert _signup(raw).status_code == 409


def test_login_happy_path(raw):
    _signup(raw)
    resp = raw.post("/auth/login", json={"email": "a@b.com", "password": "hunter2"})
    assert resp.status_code == 200
    assert resp.json()["token"]


def test_login_unknown_email_401(raw):
    resp = raw.post("/auth/login", json={"email": "missing@b.com", "password": "hunter2"})
    assert resp.status_code == 401


def test_login_wrong_password_401(raw):
    _signup(raw)
    resp = raw.post("/auth/login", json={"email": "a@b.com", "password": "WRONG"})
    assert resp.status_code == 401


def test_me_requires_token(raw):
    assert raw.get("/auth/me").status_code == 401
    assert raw.get("/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_me_returns_user_and_null_prefs(raw):
    token = _signup(raw).json()["token"]
    resp = raw.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["user"]["email"] == "a@b.com"
    assert resp.json()["preferences"] is None


def test_save_and_read_preferences(raw):
    token = _signup(raw).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    put = raw.put(
        "/auth/me/preferences",
        headers=headers,
        json={
            "workday_start_hour": 8,
            "workday_end_hour": 17,
            "max_focus_minutes_per_day": 300,
            "timezone": "Australia/Melbourne",
        },
    )
    assert put.status_code == 200
    me = raw.get("/auth/me", headers=headers).json()
    assert me["preferences"]["workday_start_hour"] == 8
    assert me["preferences"]["max_focus_minutes_per_day"] == 300
    assert me["preferences"]["timezone"] == "Australia/Melbourne"
