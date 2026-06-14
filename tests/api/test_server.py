import importlib

from fastapi import FastAPI


def test_server_module_exposes_main():
    server = importlib.import_module("weekforge.api.server")
    assert hasattr(server, "main")
    assert callable(server.main)


def test_build_app_helper_returns_fastapi(monkeypatch):
    # build_app() must construct a FastAPI without starting uvicorn.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-for-build-only")

    server = importlib.import_module("weekforge.api.server")

    import weekforge.api.server as srv

    class _FakeCouncil:  # stand-in; build_app only needs an object to pass through
        pass

    monkeypatch.setattr(srv, "build_council", lambda api_key, **kwargs: _FakeCouncil())
    app = srv.build_app()
    assert isinstance(app, FastAPI)
