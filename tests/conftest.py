from datetime import datetime, timezone

import pytest


@pytest.fixture
def utc():
    """Return a helper that builds UTC-aware datetimes: utc(y, m, d, h, mn=0)."""
    def _utc(y, m, d, h, mn=0):
        return datetime(y, m, d, h, mn, tzinfo=timezone.utc)
    return _utc
