import { Schedule } from "@/lib/types";
import { groupBlocksByDay, formatTimeRange } from "@/lib/format";

export function ScheduleView({ schedule }: { schedule: Schedule }) {
  const groups = groupBlocksByDay(schedule.blocks);

  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500" data-testid="schedule-empty">
        The council produced an empty schedule.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="schedule-view">
      {groups.map((g) => (
        <div key={g.day}>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">{g.day}</h4>
          <ul className="flex flex-col gap-1">
            {g.blocks.map((b, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-900">{b.label}</span>
                <span className="text-slate-500">{formatTimeRange(b.start, b.end)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
