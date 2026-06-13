from weekforge.api.schemas import StartDebateRequest
from weekforge.api.sessions import SessionManager


def _req() -> StartDebateRequest:
    return StartDebateRequest(tasks=[{"id": "t1", "title": "X", "estimated_minutes": 30}])


def test_create_returns_unique_thread_ids():
    mgr = SessionManager()
    a = mgr.create(_req())
    b = mgr.create(_req())
    assert a != b
    assert isinstance(a, str) and len(a) > 0


def test_get_returns_session_with_request():
    mgr = SessionManager()
    req = _req()
    tid = mgr.create(req)
    session = mgr.get(tid)
    assert session is not None
    assert session.request is req
    assert session.intervention is None


def test_get_unknown_thread_returns_none():
    mgr = SessionManager()
    assert mgr.get("does-not-exist") is None


def test_set_and_pop_intervention():
    mgr = SessionManager()
    tid = mgr.create(_req())
    mgr.set_intervention(tid, "Prioritise the report")
    assert mgr.pop_intervention(tid) == "Prioritise the report"
    # Second pop is None — interventions are consumed once.
    assert mgr.pop_intervention(tid) is None


def test_pop_intervention_unknown_thread_returns_none():
    mgr = SessionManager()
    assert mgr.pop_intervention("nope") is None
