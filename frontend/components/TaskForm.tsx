"use client";

import { useState } from "react";
import { StartDebateRequest } from "@/lib/types";

const SAMPLE: StartDebateRequest = {
  tasks: [
    {
      id: "t1",
      title: "Write Q3 report",
      estimated_minutes: 180,
      priority: 1,
      deadline: "2026-06-17T17:00:00+00:00",
      category: "writing",
    },
    { id: "t2", title: "Review 5 pull requests", estimated_minutes: 90, priority: 2, category: "code" },
    { id: "t3", title: "Prep demo slides", estimated_minutes: 120, priority: 2, category: "writing" },
    { id: "t4", title: "1:1s with the team", estimated_minutes: 60, priority: 3, category: "meetings" },
    { id: "t5", title: "Inbox zero", estimated_minutes: 45, priority: 4, category: "admin" },
  ],
  busy_blocks: [
    { start: "2026-06-15T10:00:00+00:00", end: "2026-06-15T11:00:00+00:00", label: "Standup" },
    { start: "2026-06-16T14:00:00+00:00", end: "2026-06-16T15:30:00+00:00", label: "Client call" },
  ],
  preferences: { workday_start_hour: 9, workday_end_hour: 18, max_focus_minutes_per_day: 360 },
  max_rounds: 3,
  // true = pause for you if the council stalls; false = Arbiter auto-decides.
  require_human_on_stall: true,
};

export function TaskForm({
  onStart,
  disabled,
}: {
  onStart: (req: StartDebateRequest) => void;
  disabled?: boolean;
}) {
  const [json, setJson] = useState(JSON.stringify(SAMPLE, null, 2));
  const [error, setError] = useState<string | null>(null);

  function handleStart() {
    let parsed: StartDebateRequest;
    try {
      parsed = JSON.parse(json) as StartDebateRequest;
    } catch {
      setError("That isn't valid JSON.");
      return;
    }
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      setError("Provide at least one task.");
      return;
    }
    setError(null);
    onStart(parsed);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="task-form">
      <label className="text-sm font-medium text-slate-700">
        Your week — tasks, fixed commitments, and preferences
      </label>
      <textarea
        data-testid="task-form-input"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
        className="h-64 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
      />
      {error && (
        <p className="text-sm text-rose-600" data-testid="form-error">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleStart}
        disabled={disabled}
        className="self-start rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Convene the council
      </button>
    </div>
  );
}
