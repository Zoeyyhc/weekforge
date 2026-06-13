"""Pluggable data-source providers (calendar, tasks)."""

from weekforge.providers.calendar import CalendarProvider, ICSCalendarProvider, MockCalendarProvider
from weekforge.providers.tasks import JSONTaskProvider, TaskProvider

__all__ = [
    "CalendarProvider",
    "ICSCalendarProvider",
    "JSONTaskProvider",
    "MockCalendarProvider",
    "TaskProvider",
]
