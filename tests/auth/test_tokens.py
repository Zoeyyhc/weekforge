from __future__ import annotations

import jwt
import pytest

from weekforge.auth.tokens import decode_token, issue_token

SECRET = "test-secret-key-with-32-bytes-min!!"


def test_round_trip():
    token = issue_token("user-123", SECRET)
    assert decode_token(token, SECRET) == "user-123"


def test_wrong_secret_raises():
    token = issue_token("user-123", SECRET)
    with pytest.raises(jwt.PyJWTError):
        decode_token(token, "other-secret-key-with-32-bytes!!")


def test_garbage_raises():
    with pytest.raises(jwt.PyJWTError):
        decode_token("not-a-jwt", SECRET)


def test_expired_token_raises():
    token = issue_token("user-123", SECRET, ttl_days=-1)
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_token(token, SECRET)


def test_missing_sub_claim_raises():
    token = jwt.encode({"exp": 9999999999}, SECRET, algorithm="HS256")
    with pytest.raises(jwt.PyJWTError):
        decode_token(token, SECRET)


def test_missing_exp_claim_raises():
    token = jwt.encode({"sub": "user-123"}, SECRET, algorithm="HS256")
    with pytest.raises(jwt.PyJWTError):
        decode_token(token, SECRET)
