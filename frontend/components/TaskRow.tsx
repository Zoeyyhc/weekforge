"use client";

import { TaskDraft, Weekday } from "@/lib/buildRequest";

const PRIORITIES = [1, 2, 3, 4, 5];

const PRIORITY_COLORS: Record<number, string> = {
  1: "text-rose-400",
  2: "text-amber",
  3: "text-muted",
  4: "text-[#4a4845]",
  5: "text-[#3a3530]",
};

const DAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TaskRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  onRemove: () => void;
}) {
  function handleDayClick(day: string) {
    const idx = draft.preferredDays.indexOf(day);
    if (idx >= 0) {
      onChange({ preferredDays: draft.preferredDays.filter((d) => d !== day) });
    } else if (draft.preferredDays.length < 2) {
      onChange({ preferredDays: [...draft.preferredDays, day] });
    }
  }

  return (
    <div
      className="rounded-lg border border-[#2a2620] bg-[#111318] p-3 flex flex-col gap-2"
      data-testid="task-row"
    >
      {/* Row 1: title · estimate · priority · remove */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          data-testid="task-title-input"
          aria-label="Task title"
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Task title"
          className="flex-1 bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm text-foreground placeholder:text-[#3a3530] py-1 transition-colors"
        />
        <input
          data-testid="task-minutes-input"
          type="number"
          min={1}
          value={draft.estimatedMinutes}
          onChange={(e) => onChange({ estimatedMinutes: e.target.value })}
          className="w-16 bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm font-mono text-foreground py-1 text-right transition-colors"
          aria-label="Estimated minutes"
        />
        <span className="text-xs text-[#4a4845] font-mono" aria-hidden="true">min</span>
        <select
          data-testid="task-priority-select"
          value={draft.priority}
          onChange={(e) => onChange({ priority: Number(e.target.value) })}
          className={`bg-[#0f1115] border border-[#2a2620] rounded-md px-2 py-1 text-xs font-bold transition-colors ${PRIORITY_COLORS[draft.priority] ?? "text-muted"}`}
          aria-label="Priority"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p} className="bg-[#16191f] text-foreground">
              P{p}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="task-remove"
          onClick={onRemove}
          aria-label="Remove task"
          className="text-[#3a3530] hover:text-rose-400 px-1 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Row 2: deadline toggle + weekday select */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Toggle deadline"
          onClick={() => onChange({ hasDeadline: !draft.hasDeadline })}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-colors ${
            draft.hasDeadline
              ? "bg-rose-950/40 border-rose-400/60 text-rose-300"
              : "bg-[#1a1e26] border-[#2a2620] text-[#4a4845] hover:text-muted"
          }`}
        >
          📅 deadline
        </button>
        {draft.hasDeadline && (
          <select
            aria-label="Deadline weekday"
            value={draft.deadlineWeekday}
            onChange={(e) => onChange({ deadlineWeekday: e.target.value as Weekday })}
            className="bg-transparent border-b border-rose-400/40 text-rose-300 text-xs font-mono px-1 py-0.5 outline-none"
          >
            {DAYS.map((d) => (
              <option key={d} value={d} className="bg-[#16191f]">
                {d}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Row 3: preferred days */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-[#3a3530] font-mono uppercase tracking-wider mr-1">
          prefer
        </span>
        {DAYS.map((day) => {
          const pos = draft.preferredDays.indexOf(day);
          const isFirst = pos === 0;
          const isSecond = pos === 1;
          return (
            <button
              key={day}
              type="button"
              data-testid={`day-pill-${day}`}
              onClick={() => handleDayClick(day)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold border transition-all ${
                isFirst
                  ? "bg-ember/30 text-ember border-ember/60 shadow-[0_0_8px_rgba(255,107,53,0.3)] scale-105"
                  : isSecond
                  ? "bg-amber/25 text-amber border-amber/50"
                  : "bg-[#1a1e26] text-[#4a4845] border-[#2a2620] hover:text-muted"
              }`}
            >
              {isFirst ? "① " : isSecond ? "② " : ""}
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
