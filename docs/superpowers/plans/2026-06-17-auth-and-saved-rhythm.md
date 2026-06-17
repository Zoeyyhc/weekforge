# Auth & Saved Rhythm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local email/password accounts so the landing CTA gates the console behind login and a user's scheduling rhythm persists across sessions.

**Architecture:** A self-contained `weekforge.auth` module (SQLite `UserStore` + JWT helpers) feeds a FastAPI auth router; `get_current_user` protects the debate endpoints. The Next.js frontend gains a token-backed `AuthProvider`, a forge-styled `/login` page, a client guard on `/app`, and rhythm prefill/auto-save.

**Tech Stack:** Python 3.12 / FastAPI / `sqlite3` / `bcrypt` / `pyjwt`; Next.js 16 / React 19 / vitest / Tailwind v4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-17-auth-and-saved-rhythm-design.md`.
- **TDD:** write the failing test before implementation (project red line).
- New backend deps: `bcrypt`, `pyjwt`. New env var: `WEEKFORGE_AUTH_SECRET` (HS256 key).
- Reuse `WEEKFORGE_DB_PATH` — add a `users` table to the existing SQLite file. Never commit `*.db`.
- **Local accounts only** — no OAuth, no third-party auth, no calendar write access. The `X-WEEKFORGE:1` ICS marker and calendar-safety red line are untouched.
- Never leak `password_hash` in any response. Store only the hash, never plaintext.
- JWT expiry = 7 days. bcrypt for hashing.
- Tests never call real Anthropic — mock `weekforge.debate.nodes.Anthropic` (existing `anthropic_patch` fixture).
- **Frontend:** Next.js 16 is NOT the version you know — read `frontend/AGENTS.md` and `node_modules/next/dist/docs/` before writing frontend code. Client components that touch `localStorage`/`useRouter` need `"use client"`.
- Run backend tests with `uv run pytest`; frontend with `cd frontend && npm test`.

---

## Task 1: `UserStore` — SQLite-backed accounts

**Files:**
- Modify: `pyproject.toml` (add `bcrypt>=4.0`, `pyjwt>=2.8` to `dependencies`)
- Create: `src/weekforge/auth/__init__.py` (empty)
- Create: `src/weekforge/auth/store.py`
- Create: `tests/auth/__init__.py` (empty)
- Test: `tests/auth/test_store.py`

**Interfaces:**
- Consumes: `weekforge.models.Preferences`.
- Produces:
  - `class User(BaseModel)`: `id: str`, `email: str`, `display_name: str` (no hash).
  - `class DuplicateEmailError(Exception)`.
  - `class UserStore`: `__init__(db_path: str)`; `create_user(email: str, password: str, display_name: str) -> User`; `authenticate(email: str, password: str) -> User | None`; `get_by_id(user_id: str) -> User | None`; `save_preferences(user_id: str, prefs: Preferences) -> None`; `get_preferences(user_id: str) -> Preferences | None`.

- [ ] **Step 1: Add dependencies**

In `pyproject.toml`, add to the `dependencies` list:

```toml
    "bcrypt>=4.0",
    "pyjwt>=2.8",
```

Run: `uv sync`
Expected: resolves and installs `bcrypt` and `pyjwt`.

- [ ] **Step 2: Write the failing test**

Create `tests/auth/__init__.py` (empty) and `tests/auth/test_store.py`:

```python
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/auth/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'weekforge.auth.store'`.

- [ ] **Step 4: Implement `UserStore`**

Create `src/weekforge/auth/__init__.py` (empty). Create `src/weekforge/auth/store.py`:

```python
"""SQLite-backed local account store. Hashes passwords with bcrypt; never stores plaintext."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

import bcrypt
from pydantic import BaseModel

from weekforge.models import Preferences


class User(BaseModel):
    """A local account, safe to serialize to clients (no password hash)."""

    id: str
    email: str
    display_name: str


class DuplicateEmailError(Exception):
    """Raised when creating a user whose email already exists."""


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
                    email TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    preferences TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )

    def create_user(self, email: str, password: str, display_name: str) -> User:
        user_id = uuid4().hex
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        try:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO users (id, email, display_name, password_hash, preferences, created_at)"
                    " VALUES (?, ?, ?, ?, NULL, ?)",
                    (user_id, email, display_name, password_hash, datetime.now(timezone.utc).isoformat()),
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
        if not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
            return None
        return User(id=row["id"], email=row["email"], display_name=row["display_name"])

    def get_by_id(self, user_id: str) -> User | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, email, display_name FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if row is None:
            return None
        return User(id=row["id"], email=row["email"], display_name=row["display_name"])

    def save_preferences(self, user_id: str, prefs: Preferences) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE users SET preferences = ? WHERE id = ?",
                (prefs.model_dump_json(), user_id),
            )

    def get_preferences(self, user_id: str) -> Preferences | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT preferences FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if row is None or row["preferences"] is None:
            return None
        return Preferences.model_validate_json(row["preferences"])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/auth/test_store.py -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml uv.lock src/weekforge/auth/__init__.py src/weekforge/auth/store.py tests/auth/__init__.py tests/auth/test_store.py
git commit -m "feat: UserStore — SQLite local accounts with bcrypt hashing"
```

---

## Task 2: JWT token helpers

**Files:**
- Create: `src/weekforge/auth/tokens.py`
- Test: `tests/auth/test_tokens.py`

**Interfaces:**
- Produces: `issue_token(user_id: str, secret: str, *, ttl_days: int = 7) -> str`; `decode_token(token: str, secret: str) -> str` (returns user_id; raises `jwt.PyJWTError` on invalid/expired).

- [ ] **Step 1: Write the failing test**

Create `tests/auth/test_tokens.py`:

```python
from __future__ import annotations

import jwt
import pytest

from weekforge.auth.tokens import decode_token, issue_token

SECRET = "test-secret"


def test_round_trip():
    token = issue_token("user-123", SECRET)
    assert decode_token(token, SECRET) == "user-123"


def test_wrong_secret_raises():
    token = issue_token("user-123", SECRET)
    with pytest.raises(jwt.PyJWTError):
        decode_token(token, "other-secret")


def test_garbage_raises():
    with pytest.raises(jwt.PyJWTError):
        decode_token("not-a-jwt", SECRET)


def test_expired_token_raises():
    token = issue_token("user-123", SECRET, ttl_days=-1)
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_token(token, SECRET)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/auth/test_tokens.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'weekforge.auth.tokens'`.

- [ ] **Step 3: Implement token helpers**

Create `src/weekforge/auth/tokens.py`:

```python
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
    payload = jwt.decode(token, secret, algorithms=["HS256"])
    return payload["sub"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/auth/test_tokens.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/weekforge/auth/tokens.py tests/auth/test_tokens.py
git commit -m "feat: HS256 JWT issue/decode helpers"
```

---

## Task 3: Auth router + `get_current_user` dependency

**Files:**
- Create: `src/weekforge/api/auth_routes.py`
- Modify: `src/weekforge/api/app.py` (construct `UserStore`, wire auth router + dependency)
- Modify: `src/weekforge/api/server.py` (read `WEEKFORGE_AUTH_SECRET`)
- Test: `tests/api/test_auth_routes.py`

**Interfaces:**
- Consumes: `UserStore`, `User`, `DuplicateEmailError` (Task 1); `decode_token` (Task 2); `Preferences`.
- Produces:
  - `make_get_current_user(store: UserStore, secret: str) -> Callable[..., User]` (a FastAPI dependency returning the authed `User`, 401 otherwise).
  - `create_auth_router(store: UserStore, secret: str, current_user) -> APIRouter` mounting `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `PUT /auth/me/preferences`.
  - `create_app(..., auth_secret: str = "dev-insecure-secret")` now also exposes `app.state.user_store` and the auth router.

- [ ] **Step 1: Write the failing test**

Create `tests/api/test_auth_routes.py`:

```python
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from weekforge.api.app import create_app
from tests.api.conftest import MockCouncil


@pytest.fixture
def app(tmp_path):
    return create_app(
        council=MockCouncil(),
        api_key="test-key",
        db_path=str(tmp_path / "auth_api.db"),
        auth_secret="test-secret",
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
        json={"workday_start_hour": 8, "workday_end_hour": 17, "max_focus_minutes_per_day": 300},
    )
    assert put.status_code == 200
    me = raw.get("/auth/me", headers=headers).json()
    assert me["preferences"]["workday_start_hour"] == 8
    assert me["preferences"]["max_focus_minutes_per_day"] == 300
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_auth_routes.py -v`
Expected: FAIL — `create_app()` got an unexpected keyword `auth_secret` / no `/auth/*` routes.

- [ ] **Step 3: Implement the auth router**

Create `src/weekforge/api/auth_routes.py`:

```python
"""Auth routes: signup, login, me, preferences. Local accounts only."""

from __future__ import annotations

from typing import Callable

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from weekforge.auth.store import DuplicateEmailError, User, UserStore
from weekforge.auth.tokens import decode_token, issue_token
from weekforge.models import Preferences


class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: User


class MeResponse(BaseModel):
    user: User
    preferences: Preferences | None


def make_get_current_user(store: UserStore, secret: str) -> Callable[..., User]:
    bearer = HTTPBearer(auto_error=False)

    def get_current_user(
        creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    ) -> User:
        if creds is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        try:
            user_id = decode_token(creds.credentials, secret)
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        user = store.get_by_id(user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="Unknown user")
        return user

    return get_current_user


def create_auth_router(store: UserStore, secret: str, current_user: Callable[..., User]) -> APIRouter:
    router = APIRouter(prefix="/auth")

    @router.post("/signup", response_model=AuthResponse)
    def signup(req: SignupRequest) -> AuthResponse:
        try:
            user = store.create_user(req.email, req.password, req.display_name)
        except DuplicateEmailError:
            raise HTTPException(status_code=409, detail="That email already has a seat")
        return AuthResponse(token=issue_token(user.id, secret), user=user)

    @router.post("/login", response_model=AuthResponse)
    def login(req: LoginRequest) -> AuthResponse:
        user = store.authenticate(req.email, req.password)
        if user is None:
            raise HTTPException(status_code=401, detail="Email or password is wrong")
        return AuthResponse(token=issue_token(user.id, secret), user=user)

    @router.get("/me", response_model=MeResponse)
    def me(user: User = Depends(current_user)) -> MeResponse:
        return MeResponse(user=user, preferences=store.get_preferences(user.id))

    @router.put("/me/preferences", response_model=Preferences)
    def save_preferences(prefs: Preferences, user: User = Depends(current_user)) -> Preferences:
        store.save_preferences(user.id, prefs)
        return prefs

    return router
```

- [ ] **Step 4: Wire into `create_app`**

In `src/weekforge/api/app.py`, add imports near the top:

```python
from weekforge.api.auth_routes import create_auth_router, make_get_current_user
from weekforge.auth.store import UserStore
```

Change the `create_app` signature to add `auth_secret`:

```python
def create_app(
    council: Council,
    api_key: str,
    db_path: str = "weekforge_api.db",
    allow_origins: list[str] | None = None,
    auth_secret: str = "dev-insecure-secret",
) -> FastAPI:
```

Then, inside `create_app`, after `app.state.sessions = sessions` and before the existing `app.include_router(...)` lines, build the store + dependency and mount the auth router:

```python
    user_store = UserStore(db_path)
    app.state.user_store = user_store
    get_current_user = make_get_current_user(user_store, auth_secret)
    app.include_router(create_auth_router(user_store, auth_secret, get_current_user))
```

(The debate router stays as-is in this task; Task 4 wires `get_current_user` into it.)

- [ ] **Step 5: Read `WEEKFORGE_AUTH_SECRET` in server.py**

In `src/weekforge/api/server.py`, inside `build_app()`, after the `frontend_url` line add:

```python
    auth_secret = os.environ["WEEKFORGE_AUTH_SECRET"]
```

and pass it to `create_app(...)`:

```python
    return create_app(
        council=council, api_key=api_key, db_path=db_path,
        allow_origins=[frontend_url], auth_secret=auth_secret,
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_auth_routes.py -v`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/weekforge/api/auth_routes.py src/weekforge/api/app.py src/weekforge/api/server.py tests/api/test_auth_routes.py
git commit -m "feat: auth router (signup/login/me/preferences) + get_current_user"
```

---

## Task 4: Protect the debate endpoints

**Files:**
- Modify: `src/weekforge/api/routes.py` (require auth on `/debate` + intervene; accept token on the SSE stream)
- Modify: `src/weekforge/api/app.py` (pass `get_current_user` + `auth_secret` into `create_router`)
- Modify: `tests/api/conftest.py` (authenticated `client` fixture + `token` fixture + `anon_client`)
- Test: `tests/api/test_routes.py` (add `test_debate_requires_auth`)

**Interfaces:**
- Consumes: `make_get_current_user` / `User` (Task 3); `decode_token` (Task 2).
- Produces: `create_router(council, api_key, db_path, sessions, current_user, secret)` — debate POST + intervene depend on `current_user`; stream validates a token from either the `Authorization` header or a `?token=` query param.

- [ ] **Step 1: Write the failing test**

Add to `tests/api/test_routes.py`:

```python
def test_debate_requires_auth(anon_client):
    resp = anon_client.post("/debate", json=SAMPLE_BODY)
    assert resp.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_routes.py::test_debate_requires_auth -v`
Expected: FAIL — currently `/debate` returns 200 without auth (and `anon_client` fixture missing).

- [ ] **Step 3: Update `create_router` to require auth**

In `src/weekforge/api/routes.py`, update imports and signature. Replace the `from __future__` block's imports section to add:

```python
from typing import Callable

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from weekforge.auth.store import User
from weekforge.auth.tokens import decode_token
```

Change the signature:

```python
def create_router(
    council: Council,
    api_key: str,
    db_path: str,
    sessions: SessionManager,
    current_user: Callable[..., User],
    secret: str,
) -> APIRouter:
```

Add `user` dependency to `start_debate` and `intervene`:

```python
    @router.post("/debate", response_model=StartDebateResponse)
    def start_debate(request: StartDebateRequest, user: User = Depends(current_user)) -> StartDebateResponse:
        thread_id = sessions.create(request)
        return StartDebateResponse(thread_id=thread_id)
```

```python
    @router.post("/debate/{thread_id}/intervene")
    def intervene(thread_id: str, request: InterventionRequest, user: User = Depends(current_user)) -> dict:
        if sessions.get(thread_id) is None:
            raise HTTPException(status_code=404, detail="Unknown thread_id")
        sessions.set_intervention(thread_id, request.input)
        return {"status": "accepted"}
```

Update `stream_debate` to validate a token from the header OR a query param (EventSource cannot send headers):

```python
    @router.get("/debate/{thread_id}/stream")
    def stream_debate(
        thread_id: str,
        token: str | None = Query(default=None),
        authorization: str | None = None,
    ) -> StreamingResponse:
        raw_token = token
        if raw_token is None and authorization and authorization.startswith("Bearer "):
            raw_token = authorization[len("Bearer "):]
        if raw_token is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        try:
            decode_token(raw_token, secret)
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        session = sessions.get(thread_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Unknown thread_id")
        # ... existing body unchanged from here (resume_value, event_stream, return) ...
```

Add `authorization` as a header param by importing `Header` and using it. Change the `authorization` parameter line to:

```python
    from fastapi import Header  # add to the top-level imports instead of inline
```

and in the signature use `authorization: str | None = Header(default=None)`. Keep the rest of the existing `stream_debate` body (the `resume_value`, `event_stream`, and `return StreamingResponse(...)` lines) exactly as they were.

- [ ] **Step 4: Pass the dependency from `create_app`**

In `src/weekforge/api/app.py`, update the debate-router line to pass the dependency and secret:

```python
    app.include_router(
        create_router(
            council=council,
            api_key=api_key,
            db_path=db_path,
            sessions=sessions,
            current_user=get_current_user,
            secret=auth_secret,
        )
    )
```

- [ ] **Step 5: Update conftest with authenticated fixtures**

In `tests/api/conftest.py`, replace the `client` fixture and add `token` + `anon_client`. The authed `client` registers a user and sets a default `Authorization` header so existing tests keep passing:

```python
@pytest.fixture
def app(tmp_path):
    return create_app(
        council=MockCouncil(),
        api_key="test-key",
        db_path=str(tmp_path / "api_test.db"),
        auth_secret="test-secret",
    )


@pytest.fixture
def token(app):
    c = TestClient(app)
    resp = c.post(
        "/auth/signup",
        json={"email": "test@b.com", "password": "pw", "display_name": "Tester"},
    )
    return resp.json()["token"]


@pytest.fixture
def client(app, token):
    c = TestClient(app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


@pytest.fixture
def anon_client(app):
    return TestClient(app)
```

Remove the old `client` fixture (the one that called `create_app` inline).

- [ ] **Step 6: Run the full API suite**

Run: `uv run pytest tests/api -v`
Expected: PASS — `test_debate_requires_auth` passes; existing debate/stream tests still pass because the authed `client` sends the default Bearer header (the stream accepts it via the `Authorization` header path).

- [ ] **Step 7: Commit**

```bash
git add src/weekforge/api/routes.py src/weekforge/api/app.py tests/api/conftest.py tests/api/test_routes.py
git commit -m "feat: require auth on debate endpoints; token via header or SSE query"
```

---

## Task 5: Frontend auth client (`lib/auth.ts`)

**Files:**
- Create: `frontend/lib/apiBase.ts`
- Modify: `frontend/lib/api.ts` (import `API_BASE` from `apiBase`; attach auth header; token on stream URL)
- Create: `frontend/lib/auth.ts`
- Test: `frontend/lib/auth.test.ts`

**Interfaces:**
- Produces (`lib/auth.ts`):
  - `interface User { id: string; email: string; display_name: string }`
  - `interface SavedPreferences { workday_start_hour: number; workday_end_hour: number; max_focus_minutes_per_day: number; timezone: string | null }`
  - `getToken(): string | null`, `setToken(t: string): void`, `clearToken(): void`
  - `signup(email, password, displayName): Promise<{ token: string; user: User }>`
  - `login(email, password): Promise<{ token: string; user: User }>`
  - `fetchMe(token): Promise<{ user: User; preferences: SavedPreferences | null }>`
  - `savePreferences(token, prefs: SavedPreferences): Promise<SavedPreferences>`
- Produces (`lib/apiBase.ts`): `API_BASE: string`.

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/auth.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, login, setToken, signup } from "@/lib/auth";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("token storage", () => {
  it("round-trips and clears", () => {
    expect(getToken()).toBeNull();
    setToken("abc");
    expect(getToken()).toBe("abc");
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe("signup/login", () => {
  it("signup posts credentials and returns token + user", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "t1", user: { id: "u1", email: "a@b.com", display_name: "Ada" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await signup("a@b.com", "pw", "Ada");
    expect(res.token).toBe("t1");
    expect(res.user.display_name).toBe("Ada");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/signup$/);
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.com", password: "pw", display_name: "Ada" });
  });

  it("login throws on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(login("a@b.com", "bad")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- auth.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth`.

- [ ] **Step 3: Extract `API_BASE` and implement `lib/auth.ts`**

Create `frontend/lib/apiBase.ts`:

```ts
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8001";
```

In `frontend/lib/api.ts`, replace the inline `API_BASE` declaration with a re-export and import:

```ts
import { StartDebateRequest, TimeBlock } from "@/lib/types";
import { API_BASE } from "@/lib/apiBase";
import { getToken } from "@/lib/auth";

export { API_BASE };

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

Then add `...authHeaders()` to the `headers` of `startDebate` and `sendIntervention`, e.g.:

```ts
    headers: { "Content-Type": "application/json", ...authHeaders() },
```

And append the token to the stream URL so `EventSource` is authenticated:

```ts
export function streamUrl(threadId: string, base: string = API_BASE): string {
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${base}/debate/${threadId}/stream${q}`;
}
```

Create `frontend/lib/auth.ts`:

```ts
import { API_BASE } from "@/lib/apiBase";

export interface User {
  id: string;
  email: string;
  display_name: string;
}

export interface SavedPreferences {
  workday_start_hour: number;
  workday_end_hour: number;
  max_focus_minutes_per_day: number;
  timezone: string | null;
}

const TOKEN_KEY = "weekforge.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function signup(email: string, password: string, displayName: string) {
  return postJson<{ token: string; user: User }>("/auth/signup", {
    email,
    password,
    display_name: displayName,
  });
}

export function login(email: string, password: string) {
  return postJson<{ token: string; user: User }>("/auth/login", { email, password });
}

export async function fetchMe(
  token: string,
): Promise<{ user: User; preferences: SavedPreferences | null }> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchMe failed: ${res.status}`);
  return res.json();
}

export async function savePreferences(
  token: string,
  prefs: SavedPreferences,
): Promise<SavedPreferences> {
  const res = await fetch(`${API_BASE}/auth/me/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error(`savePreferences failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- auth.test.ts`
Expected: PASS. Then `cd frontend && npm test -- api.test.ts` still PASS (re-exported `API_BASE` unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/apiBase.ts frontend/lib/api.ts frontend/lib/auth.ts frontend/lib/auth.test.ts
git commit -m "feat: frontend auth client + bearer header on debate calls"
```

---

## Task 6: `AuthProvider` / `useAuth` context

**Files:**
- Create: `frontend/lib/authContext.tsx`
- Modify: `frontend/app/layout.tsx` (wrap children in `<AuthProvider>`)
- Test: `frontend/lib/authContext.test.tsx`

**Interfaces:**
- Consumes: `getToken/setToken/clearToken`, `login`, `signup`, `fetchMe`, `User` (Task 5).
- Produces:
  - `<AuthProvider>{children}</AuthProvider>`
  - `useAuth(): { user: User | null; status: "loading" | "authed" | "anon"; signIn(email,password): Promise<void>; register(email,password,displayName): Promise<void>; signOut(): void }`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/authContext.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/authContext";
import * as authApi from "@/lib/auth";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("useAuth", () => {
  it("starts anon when no token", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("anon"));
    expect(result.current.user).toBeNull();
  });

  it("hydrates user from stored token", async () => {
    localStorage.setItem("weekforge.token", "t1");
    vi.spyOn(authApi, "fetchMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      preferences: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authed"));
    expect(result.current.user?.display_name).toBe("Ada");
  });

  it("signOut clears user and token", async () => {
    localStorage.setItem("weekforge.token", "t1");
    vi.spyOn(authApi, "fetchMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      preferences: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authed"));
    act(() => result.current.signOut());
    expect(result.current.status).toBe("anon");
    expect(localStorage.getItem("weekforge.token")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- authContext.test.tsx`
Expected: FAIL — cannot resolve `@/lib/authContext`.

- [ ] **Step 3: Implement the provider**

Create `frontend/lib/authContext.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  clearToken,
  fetchMe,
  getToken,
  login as loginApi,
  setToken,
  signup as signupApi,
  type User,
} from "@/lib/auth";

type Status = "loading" | "authed" | "anon";

interface AuthValue {
  user: User | null;
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setStatus("anon");
      return;
    }
    fetchMe(token)
      .then((res) => {
        setUser(res.user);
        setStatus("authed");
      })
      .catch(() => {
        clearToken();
        setStatus("anon");
      });
  }, []);

  const signIn = async (email: string, password: string) => {
    const { token, user } = await loginApi(email, password);
    setToken(token);
    setUser(user);
    setStatus("authed");
  };

  const register = async (email: string, password: string, displayName: string) => {
    const { token, user } = await signupApi(email, password, displayName);
    setToken(token);
    setUser(user);
    setStatus("authed");
  };

  const signOut = () => {
    clearToken();
    setUser(null);
    setStatus("anon");
  };

  return (
    <AuthContext.Provider value={{ user, status, signIn, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 4: Mount in layout**

In `frontend/app/layout.tsx`, add the import:

```tsx
import { AuthProvider } from "@/lib/authContext";
```

Wrap the body children:

```tsx
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- authContext.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/authContext.tsx frontend/app/layout.tsx frontend/lib/authContext.test.tsx
git commit -m "feat: AuthProvider/useAuth context, mounted in root layout"
```

---

## Task 7: Forge-styled `/login` page

**Files:**
- Create: `frontend/app/login/page.tsx`
- Test: `frontend/app/login/page.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 6); `useRouter` from `next/navigation`; `ForgeBackground`, `ForgeLogo`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/login/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const signIn = vi.fn().mockResolvedValue(undefined);
const register = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/authContext", () => ({
  useAuth: () => ({ user: null, status: "anon", signIn, register, signOut: vi.fn() }),
}));

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  it("logs in and redirects to /app", async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /enter|convene|sign in/i }));
    expect(signIn).toHaveBeenCalledWith("a@b.com", "pw");
  });

  it("shows the display-name field after switching to signup", async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: /claim a seat|sign up|create/i }));
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- login/page.test.tsx`
Expected: FAIL — cannot resolve `@/app/login/page`.

- [ ] **Step 3: Implement the page**

Create `frontend/app/login/page.tsx`. Match the forge aesthetic — reuse `ForgeBackground`, `ForgeLogo`, `font-display`, ember/amber accents, inputs styled like the intake panel (`border-[#272430]`, `bg-surface/60`, `backdrop-blur`):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
import { ForgeBackground } from "@/components/landing/ForgeBackground";
import { ForgeLogo } from "@/components/ForgeLogo";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await register(email, password, displayName);
      } else {
        await signIn(email, password);
      }
      router.push("/app");
    } catch {
      setError(
        mode === "signup"
          ? "That email may already have a seat at the council."
          : "Email or password is wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[#272430] bg-surface/60 px-4 py-2.5 text-foreground outline-none backdrop-blur-sm transition-colors focus:border-ember";

  return (
    <main className="relative grid min-h-dvh place-items-center px-6">
      <ForgeBackground />
      <div className="animate-forge-in relative z-10 w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <ForgeLogo size="md" href="/" />
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-[#272430] bg-surface/60 p-8 backdrop-blur-sm">
          <div aria-hidden className="forge-mesh animate-mesh-drift absolute inset-0 opacity-30" />
          <div className="relative">
            <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-amber/80">
              {mode === "signup" ? "Claim your seat" : "Return to the forge"}
            </p>
            <h1 className="mt-2 font-display text-3xl font-light tracking-tight text-foreground">
              {mode === "signup" ? "Join the council" : "Enter the forge"}
            </h1>

            <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
              {mode === "signup" && (
                <label className="flex flex-col gap-1.5 text-sm text-muted">
                  Name
                  <input
                    className={inputClass}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </label>
              )}
              <label className="flex flex-col gap-1.5 text-sm text-muted">
                Email
                <input
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-muted">
                Password
                <input
                  type="password"
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>

              {error && <p className="text-sm text-hawk">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="mt-2 rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {mode === "signup" ? "Claim a seat" : "Enter the forge"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === "login" ? "signup" : "login"));
                setError(null);
              }}
              className="mt-5 text-xs text-muted transition-colors hover:text-amber"
            >
              {mode === "login"
                ? "No seat yet? Claim a seat at the council."
                : "Already sworn in? Return to the forge."}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- login/page.test.tsx`
Expected: PASS (2 tests). (The signup-toggle button label "Claim a seat at the council." matches `/claim a seat/i`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/login/page.tsx frontend/app/login/page.test.tsx
git commit -m "feat: forge-styled login/signup page"
```

---

## Task 8: Gate `/app` + header logout

**Files:**
- Modify: `frontend/app/app/page.tsx` (redirect to `/login` when unauthenticated; show display name + logout in header)
- Test: `frontend/app/app/page.test.tsx` (add gate redirect test — extend the existing test file)

**Interfaces:**
- Consumes: `useAuth` (Task 6); `useRouter` from `next/navigation`.

- [ ] **Step 1: Write the failing test**

Read the existing `frontend/app/app/page.test.tsx` first to match its mock setup, then add a gate test. The test mocks `next/navigation` and `@/lib/authContext`:

```tsx
// At top of the existing test file, ensure these mocks exist:
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// In a new test:
it("redirects to /login when unauthenticated", async () => {
  vi.doMock("@/lib/authContext", () => ({
    useAuth: () => ({ user: null, status: "anon", signOut: vi.fn() }),
  }));
  const { default: Home } = await import("@/app/app/page");
  render(<Home />);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
});
```

If the existing test file already renders `Home` without an `AuthProvider`, wrap those renders or mock `@/lib/authContext` to return an authed user so they keep passing:

```tsx
vi.mock("@/lib/authContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "a@b.com", display_name: "Ada" },
    status: "authed",
    signOut: vi.fn(),
  }),
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- app/page.test.tsx`
Expected: FAIL — `Home` does not import `useAuth`/redirect yet.

- [ ] **Step 3: Add the guard + header control**

In `frontend/app/app/page.tsx`, add imports:

```tsx
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/authContext";
```

At the top of the `Home` component body, add the guard:

```tsx
  const router = useRouter();
  const { user, status, signOut } = useAuth();

  useEffect(() => {
    if (status === "anon") router.push("/login");
  }, [status, router]);
```

Guard the render while resolving / redirecting (place right before the main `return`):

```tsx
  if (status !== "authed") {
    return null; // loading or redirecting to /login
  }
```

In the app header (where `ForgeLogo` is rendered), add the display name + a logout button. Find the header element containing `<ForgeLogo` and add alongside it:

```tsx
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted">{user?.display_name}</span>
          <button
            type="button"
            onClick={signOut}
            className="rounded-full border border-border px-3 py-1 text-xs text-foreground/80 transition-colors hover:border-amber/50 hover:text-foreground"
          >
            Leave the forge
          </button>
        </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- app/page.test.tsx`
Expected: PASS — gate redirects when anon; authed render still works.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/app/page.tsx frontend/app/app/page.test.tsx
git commit -m "feat: gate /app behind auth + header logout"
```

---

## Task 9: Rhythm prefill + auto-save

**Files:**
- Modify: `frontend/components/TaskForm.tsx` (accept `initialPrefs`, seed state from it)
- Modify: `frontend/app/app/page.tsx` (load `/me` prefs → pass to TaskForm; save prefs on debate start)
- Test: `frontend/components/TaskForm.test.tsx` (prefill test — extend existing file)

**Interfaces:**
- Consumes: `useAuth` (Task 6); `fetchMe`, `savePreferences`, `getToken`, `SavedPreferences` (Task 5); `PrefsDraft` from `@/lib/buildRequest`.
- Produces: `TaskForm` gains optional prop `initialPrefs?: PrefsDraft`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/components/TaskForm.test.tsx`:

```tsx
it("prefills the rhythm step from initialPrefs", async () => {
  render(
    <TaskForm
      onStart={vi.fn()}
      weekStart="2026-06-15"
      onWeekChange={vi.fn()}
      initialPrefs={{ workdayStartHour: "7", workdayEndHour: "15", maxFocusMinutes: "240" }}
    />,
  );
  // advance to the rhythm step (the existing test file shows how it navigates;
  // reuse that helper / step-click pattern), then assert:
  const focus = await screen.findByTestId("pref-focus");
  expect((focus as HTMLInputElement).value).toBe("240");
});
```

Match the existing `TaskForm.test.tsx` render props and step-navigation pattern (read the file first); the key new assertion is that `initialPrefs` flows into the rhythm inputs.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- TaskForm.test.tsx`
Expected: FAIL — `TaskForm` does not accept `initialPrefs`; focus value stays at the seed `"360"`.

- [ ] **Step 3: Accept `initialPrefs` in TaskForm**

In `frontend/components/TaskForm.tsx`, add `initialPrefs?: PrefsDraft` to the props type (the `}: {` block around line 158) and to the destructured params (around line 152). Then seed the prefs state from it — find the `useState` that initializes from `SEED_PREFS` and change it to:

```tsx
  const [prefs, setPrefs] = useState<PrefsDraft>(initialPrefs ?? SEED_PREFS);
```

Ensure `PrefsDraft` is imported from `@/lib/buildRequest` (it already imports from there; add `PrefsDraft` to that import if missing).

- [ ] **Step 4: Wire prefill + auto-save in the page**

In `frontend/app/app/page.tsx`:

Add imports:

```tsx
import { fetchMe, getToken, savePreferences, type SavedPreferences } from "@/lib/auth";
import type { PrefsDraft } from "@/lib/buildRequest";
```

Add state + load effect (after the `useAuth` line from Task 8):

```tsx
  const [initialPrefs, setInitialPrefs] = useState<PrefsDraft | undefined>(undefined);

  useEffect(() => {
    if (status !== "authed") return;
    const token = getToken();
    if (!token) return;
    fetchMe(token)
      .then((res) => {
        if (!res.preferences) return;
        setInitialPrefs({
          workdayStartHour: String(res.preferences.workday_start_hour),
          workdayEndHour: String(res.preferences.workday_end_hour),
          maxFocusMinutes: String(res.preferences.max_focus_minutes_per_day),
        });
      })
      .catch(() => {});
  }, [status]);
```

Pass it to the `<TaskForm ... />` render: add `initialPrefs={initialPrefs}`.

Wrap the existing debate-start handler so it saves the rhythm. Find where `start(req)` is invoked from the TaskForm's `onStart` and persist prefs from the request:

```tsx
  const handleStart = (req: StartDebateRequest) => {
    const token = getToken();
    if (token && req.preferences) {
      const p = req.preferences;
      const prefs: SavedPreferences = {
        workday_start_hour: p.workday_start_hour ?? 9,
        workday_end_hour: p.workday_end_hour ?? 18,
        max_focus_minutes_per_day: p.max_focus_minutes_per_day ?? 360,
        timezone: null,
      };
      void savePreferences(token, prefs).catch(() => {});
    }
    start(req);
  };
```

Replace the `onStart={start}` (or inline `onStart` that calls `start`) on `<TaskForm />` with `onStart={handleStart}`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- TaskForm.test.tsx`
Expected: PASS — rhythm prefilled from `initialPrefs`.

- [ ] **Step 6: Run the full frontend + backend suites**

Run: `cd frontend && npm test`
Run: `uv run pytest`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/TaskForm.tsx frontend/app/app/page.tsx frontend/components/TaskForm.test.tsx
git commit -m "feat: prefill rhythm from saved prefs + auto-save on debate start"
```

---

## Task 10: Docs + env

**Files:**
- Modify: `CLAUDE.md` (auth module in architecture map; `WEEKFORGE_AUTH_SECRET` in env table)
- Modify: `README.md` (login required; local accounts; env var)
- Modify: `.env.example` if present (add `WEEKFORGE_AUTH_SECRET`)

- [ ] **Step 1: Update CLAUDE.md**

Add to the architecture map: `src/weekforge/auth/` — `store.py` (`UserStore`, SQLite local accounts, bcrypt) + `tokens.py` (HS256 JWT). Add `src/weekforge/api/auth_routes.py` — signup/login/me/preferences + `get_current_user`. Note that the debate endpoints now require auth. Add `WEEKFORGE_AUTH_SECRET` to the env var table (purpose: HS256 signing key for session JWTs; required at startup).

- [ ] **Step 2: Update README.md**

Note that the console now requires a local account (email/password/display name); rhythm preferences persist across sessions; still no calendar write access / no OAuth.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document local auth + WEEKFORGE_AUTH_SECRET"
```

---

## Self-Review notes

- **Spec coverage:** UserStore (T1), tokens (T2), auth router + dependency (T3), protected debate endpoints incl. SSE `?token=` (T4), frontend auth client (T5), AuthProvider (T6), `/login` page (T7), `/app` gate + logout (T8), rhythm prefill + auto-save (T9), docs/env (T10). All spec sections mapped.
- **No recurring busy blocks** — intentionally absent (deferred per spec).
- **Type consistency:** `User` shape `{id,email,display_name}` consistent backend↔frontend; `SavedPreferences` mirrors `Preferences` fields; `current_user` dependency name consistent across T3/T4.
- **Known follow-ups for the implementer:** read existing `frontend/app/app/page.test.tsx` and `TaskForm.test.tsx` before editing them (their render-prop and step-navigation patterns must be matched); confirm the `Home` component already imports `useEffect`/`useState` (it does).
