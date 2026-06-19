from __future__ import annotations

import pytest

from weekforge.auth.store import DuplicateEmailError, User, UserStore
from weekforge.models import Preferences


@pytest.fixture
def store(tmp_path):
    return UserStore(str(tmp_path / "auth.db"))


def test_create_user_returns_user_without_hash(store):
    user = store.create_user("a@b.com", "hunter2", "Ada")
    assert isinstance(user, User)
    assert user.email == "a@b.com"
    assert user.display_name == "Ada"
    assert user.id
    assert not hasattr(user, "password_hash")


def test_duplicate_email_raises(store):
    store.create_user("a@b.com", "pw", "Ada")
    with pytest.raises(DuplicateEmailError):
        store.create_user("a@b.com", "other", "Bob")


def test_authenticate_accepts_correct_password(store):
    created = store.create_user("a@b.com", "hunter2", "Ada")
    got = store.authenticate("a@b.com", "hunter2")
    assert got is not None and got.id == created.id


def test_authenticate_rejects_wrong_password(store):
    store.create_user("a@b.com", "hunter2", "Ada")
    assert store.authenticate("a@b.com", "WRONG") is None


def test_authenticate_unknown_email_returns_none(store):
    assert store.authenticate("nobody@b.com", "pw") is None


def test_get_by_id_round_trip(store):
    created = store.create_user("a@b.com", "pw", "Ada")
    assert store.get_by_id(created.id).email == "a@b.com"
    assert store.get_by_id("missing") is None


def test_preferences_round_trip(store):
    user = store.create_user("a@b.com", "pw", "Ada")
    assert store.get_preferences(user.id) is None
    prefs = Preferences(workday_start_hour=8, workday_end_hour=17, max_focus_minutes_per_day=300)
    store.save_preferences(user.id, prefs)
    loaded = store.get_preferences(user.id)
    assert loaded.workday_start_hour == 8
    assert loaded.max_focus_minutes_per_day == 300


def test_old_preferences_without_per_block_loads_with_default(store):
    user = store.create_user("c@d.com", "pw", "Cy")
    # Simulate a row written before the field existed.
    legacy_json = (
        '{"workday_start_hour": 9, "workday_end_hour": 18, '
        '"max_focus_minutes_per_day": 360, "timezone": null}'
    )
    with store._connect() as conn:
        conn.execute(
            "UPDATE users SET preferences = ? WHERE id = ?", (legacy_json, user.id)
        )
    prefs = store.get_preferences(user.id)
    assert prefs is not None
    assert prefs.max_focus_minutes_per_block == 90
