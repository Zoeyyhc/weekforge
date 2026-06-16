"""build_app wires WEEKFORGE_ARBITER_MODEL into the council."""

from __future__ import annotations

from unittest.mock import patch


def test_build_app_passes_arbiter_model(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setenv("WEEKFORGE_ARBITER_MODEL", "anthropic/claude-sonnet-x")

    with (
        patch("weekforge.api.server.build_council") as mock_bc,
        patch("weekforge.api.server._build_google_integration"),
        patch("weekforge.api.server.create_app"),
    ):
        from weekforge.api.server import build_app

        build_app()

    assert mock_bc.call_args.kwargs.get("arbiter_model") == "anthropic/claude-sonnet-x"
