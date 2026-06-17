"""HS256 JWT helpers for session tokens."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt


def issue_token(user_id: str, secret: str, *, ttl_days: int = 7) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=ttl_days),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str, secret: str) -> str:
    payload = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["sub", "exp"]})
    return payload["sub"]
