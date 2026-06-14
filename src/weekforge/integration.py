"""GoogleIntegration facade — composes auth, provider, and writer.

Injected into the FastAPI app identically to how `council` is already injected.
Tests inject a FakeGoogleIntegration; this class is verified by manual smoke.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

from googleapiclient.discovery import build as _build_service

from weekforge.auth.google_oauth import credentials_from_dict, build_authorization_url, exchange_code
from weekforge.auth.token_store import OAuthTokenStore
from weekforge.models import TimeBlock
from weekforge.providers.google_calendar import (
    GoogleCalendarWriter,
    GoogleCalendarProvider,
    RealGoogleCalendarClient,
)


class GoogleIntegration:
    """Facade used by all Google Calendar routes."""

    def __init__(
        self,
        token_store: OAuthTokenStore,
        calendar_name: str = "WeekForge",
        frontend_url: str = "http://localhost:3000",
    ) -> None:
        self._store = token_store
        self._calendar_name = calendar_name
        self._frontend_url = frontend_url
        self._pending_code_verifier: str | None = None

    def is_connected(self) -> bool:
        return self._store.load() is not None

    def login_url(self) -> str:
        url, _state, verifier = build_authorization_url()
        if not verifier:
            # PKCE challenge is in the URL; without the matching verifier the
            # callback would fail with Google's cryptic "Missing code verifier".
            # Fail loudly here instead.
            raise RuntimeError("OAuth flow did not produce a PKCE code_verifier")
        self._pending_code_verifier = verifier
        return url

    def complete_login(self, code: str) -> None:
        creds_dict = exchange_code(code, code_verifier=self._pending_code_verifier)
        self._pending_code_verifier = None
        self._store.save(creds_dict)

    def disconnect(self) -> None:
        self._store.clear()

    def frontend_url(self) -> str:
        return self._frontend_url

    def _client(self) -> RealGoogleCalendarClient:
        data = self._store.load()
        if data is None:
            raise RuntimeError("Not connected to Google Calendar")
        creds = credentials_from_dict(data)
        service = _build_service("calendar", "v3", credentials=creds)
        return RealGoogleCalendarClient(service)

    def import_busy(self, week_start: datetime) -> list[TimeBlock]:
        week_end = week_start + timedelta(days=7)
        provider = GoogleCalendarProvider(self._client())
        return provider.get_busy_blocks(week_start, week_end)

    def export_schedule(
        self, blocks: list[TimeBlock], week_start: datetime
    ) -> tuple[int, str]:
        """Write blocks to the WeekForge calendar. Returns (written_count, calendar_url)."""
        week_end = week_start + timedelta(days=7)
        writer = GoogleCalendarWriter(self._client(), calendar_name=self._calendar_name)
        count = writer.write_blocks(blocks, week_start, week_end)
        calendar_url = "https://calendar.google.com/calendar/r/week"
        return count, calendar_url


class UnconfiguredGoogleIntegration:
    """Returned when Google env vars are absent. All routes gracefully return not-connected."""

    def is_connected(self) -> bool:
        return False

    def login_url(self) -> str:
        raise RuntimeError("Google OAuth is not configured")

    def complete_login(self, code: str) -> None:
        raise RuntimeError("Google OAuth is not configured")

    def disconnect(self) -> None:
        pass

    def frontend_url(self) -> str:
        return os.environ.get("WEEKFORGE_FRONTEND_URL", "http://localhost:3000")

    def import_busy(self, week_start: datetime) -> list[TimeBlock]:
        raise RuntimeError("Google Calendar is not configured")

    def export_schedule(self, blocks: list[TimeBlock], week_start: datetime) -> tuple[int, str]:
        raise RuntimeError("Google Calendar is not configured")
