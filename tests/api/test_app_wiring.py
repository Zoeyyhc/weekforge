from weekforge.api.app import create_app


class _StubCouncil:
    pass


def test_app_exposes_ics_export_and_no_google_routes():
    app = create_app(council=_StubCouncil(), api_key="test", db_path="test_wiring.db")
    paths = {route.path for route in app.routes}
    assert "/calendar/ics/export" in paths
    assert not any(p.startswith("/auth/google") for p in paths)
