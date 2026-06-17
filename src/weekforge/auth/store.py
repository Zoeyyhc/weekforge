"""SQLite-backed local account store.

Passwords are hashed with bcrypt and never stored or returned in plaintext.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

import bcrypt
from pydantic import BaseModel

from weekforge.models import Preferences


class User(BaseModel):
    """A local account safe to return to callers."""

    id: str
    email: str
    display_name: str


class DuplicateEmailError(Exception):
    """Raised when creating a user with an email that already exists."""


class UserStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    preferences TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )

    @staticmethod
    def _user_from_row(row: sqlite3.Row) -> User:
        return User(id=row["id"], email=row["email"], display_name=row["display_name"])

    def create_user(self, email: str, password: str, display_name: str) -> User:
        user_id = uuid4().hex
        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        created_at = datetime.now(timezone.utc).isoformat()
        try:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO users (id, email, display_name, password_hash, preferences, created_at)
                    VALUES (?, ?, ?, ?, NULL, ?)
                    """,
                    (user_id, email, display_name, password_hash, created_at),
                )
        except sqlite3.IntegrityError as exc:
            raise DuplicateEmailError(email) from exc
        return User(id=user_id, email=email, display_name=display_name)

    def authenticate(self, email: str, password: str) -> User | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, email, display_name, password_hash FROM users WHERE email = ?",
                (email,),
            ).fetchone()
        if row is None:
            return None
        if not bcrypt.checkpw(password.encode("utf-8"), row["password_hash"].encode("utf-8")):
            return None
        return self._user_from_row(row)

    def get_by_id(self, user_id: str) -> User | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, email, display_name FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return self._user_from_row(row)

    def save_preferences(self, user_id: str, prefs: Preferences) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE users SET preferences = ? WHERE id = ?",
                (prefs.model_dump_json(), user_id),
            )

    def get_preferences(self, user_id: str) -> Preferences | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT preferences FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row is None or row["preferences"] is None:
            return None
        return Preferences.model_validate_json(row["preferences"])
