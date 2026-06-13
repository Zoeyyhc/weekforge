"use client";

import { TaskDraft } from "@/lib/buildRequest";

const PRIORITIES = [1, 2, 3, 4];

export function TaskRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="task-row">
      <input
        data-testid="task-title-input"
        value={draft.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Task title"
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        data-testid="task-minutes-input"
        type="number"
        min={1}
        value={draft.estimatedMinutes}
        onChange={(e) => onChange({ estimatedMinutes: e.target.value })}
        className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="Estimated minutes"
      />
      <span className="text-xs text-slate-400">min</span>
      <select
        data-testid="task-priority-select"
        value={draft.priority}
        onChange={(e) => onChange({ priority: Number(e.target.value) })}
        className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="Priority"
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            P{p}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="task-remove"
        onClick={onRemove}
        aria-label="Remove task"
        className="rounded-lg px-2 py-2 text-slate-400 hover:text-rose-600"
      >
        ✕
      </button>
    </div>
  );
}
