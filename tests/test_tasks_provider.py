from datetime import datetime, timezone
from pathlib import Path

from weekforge.providers.tasks import JSONTaskProvider

FIXTURE = Path(__file__).parent / "fixtures" / "sample_tasks.json"


def test_json_loads_all_tasks():
    provider = JSONTaskProvider(FIXTURE)

    tasks = provider.get_tasks()

    assert [t.id for t in tasks] == ["t1", "t2", "t3"]


def test_json_parses_fields_and_defaults():
    provider = JSONTaskProvider(FIXTURE)

    tasks = {t.id: t for t in provider.get_tasks()}

    assert tasks["t1"].deadline == datetime(2026, 6, 19, 17, 0, tzinfo=timezone.utc)
    assert tasks["t1"].priority == 1
    assert tasks["t1"].category == "writing"
    # t3 omits priority -> default 3, omits deadline -> None
    assert tasks["t3"].priority == 3
    assert tasks["t3"].deadline is None
    assert tasks["t3"].depends_on == []
