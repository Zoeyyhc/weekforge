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
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
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
        except DuplicateEmailError as exc:
            raise HTTPException(status_code=409, detail="That email already has a seat") from exc
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
