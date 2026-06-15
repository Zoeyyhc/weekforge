"use client";

import { useState } from "react";
import React from "react";
import { StartDebateRequest } from "@/lib/types";
import {
  buildRequest,
  TaskDraft,
  BusyBlockDraft,
  PrefsDraft,
} from "@/lib/buildRequest";
import { TaskRow } from "@/components/TaskRow";
import { BusyBlockRow } from "@/components/BusyBlockRow";

let _draftIdCounter = 0;
function nextDraftId(): string {
  return `draft-${++_draftIdCounter}`;
}

const SEED_TASKS: TaskDraft[] = [
  { id: nextDraftId(), title: "Write Q3 report", estimatedMinutes: "180", priority: 1, hasDeadline: false, deadlineWeekday: "Fri" as const, preferredDays: [] },
  { id: nextDraftId(), title: "Review 5 pull requests", estimatedMinutes: "90", priority: 2, hasDeadline: false, deadlineWeekday: "Fri" as const, preferredDays: [] },
];
const SEED_BLOCKS: BusyBlockDraft[] = [
  { id: nextDraftId(), label: "Standup", start: "2026-06-15T10:00", end: "2026-06-15T11:00" },
];
const SEED_PREFS: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};

function validate(tasks: TaskDraft[], blocks: BusyBlockDraft[]): string | null {
  const titled = tasks.filter((t) => t.title.trim() !== "");
  if (titled.length === 0) return "Add at least one task with a title.";
  if (titled.some((t) => !(Number(t.estimatedMinutes) > 0)))
    return "Every task needs an estimate greater than 0 minutes.";
  for (const b of blocks) {
    if (b.start && b.end && new Date(b.end) <= new Date(b.start))
      return "Each busy block must end after it starts.";
  }
  return null;
}

export function TaskForm({
  onStart,
  disabled,
  googleSlot,
}: {
  onStart: (req: StartDebateRequest) => void;
  disabled?: boolean;
  googleSlot?: React.ReactNode;
}) {
  const [tasks, setTasks] = useState<TaskDraft[]>(SEED_TASKS);
  const [blocks, setBlocks] = useState<BusyBlockDraft[]>(SEED_BLOCKS);
  const [prefs, setPrefs] = useState<PrefsDraft>(SEED_PREFS);
  const [error, setError] = useState<string | null>(null);

  function patchTask(i: number, patch: Partial<TaskDraft>) {
    setTasks((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function patchBlock(i: number, patch: Partial<BusyBlockDraft>) {
    setBlocks((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  function handleStart() {
    const err = validate(tasks, blocks);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    // Drop tasks with empty titles before building the request.
    const titledTasks = tasks.filter((t) => t.title.trim() !== "");
    const populatedBlocks = blocks.filter((b) => b.start !== "" && b.end !== "");
    onStart(buildRequest(titledTasks, populatedBlocks, prefs));
  }

  return (
    <div className="flex flex-col gap-6" data-testid="task-form">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tasks</h2>
          <button
            type="button"
            data-testid="add-task-btn"
            onClick={() => setTasks((prev) => [...prev, { id: nextDraftId(), title: "", estimatedMinutes: "60", priority: 2, hasDeadline: false, deadlineWeekday: "Fri" as const, preferredDays: [] }])}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            + Add task
          </button>
        </div>
        {tasks.map((t, i) => (
          <TaskRow
            key={t.id}
            draft={t}
            onChange={(patch) => patchTask(i, patch)}
            onRemove={() => setTasks((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Busy blocks
          </h2>
          <button
            type="button"
            data-testid="add-block-btn"
            onClick={() => setBlocks((prev) => [...prev, { id: nextDraftId(), label: "", start: "", end: "" }])}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            + Add block
          </button>
        </div>
        {googleSlot}
        {blocks.map((b, i) => (
          <BusyBlockRow
            key={b.id}
            draft={b}
            onChange={(patch) => patchBlock(i, patch)}
            onRemove={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Preferences</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-1">
            Workday
            <input
              data-testid="pref-start"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayStartHour}
              onChange={(e) => setPrefs({ ...prefs, workdayStartHour: e.target.value })}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1"
              aria-label="Workday start hour"
            />
            –
            <input
              data-testid="pref-end"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayEndHour}
              onChange={(e) => setPrefs({ ...prefs, workdayEndHour: e.target.value })}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1"
              aria-label="Workday end hour"
            />
          </label>
          <label className="flex items-center gap-1">
            Max focus
            <input
              data-testid="pref-focus"
              type="number"
              min={0}
              value={prefs.maxFocusMinutes}
              onChange={(e) => setPrefs({ ...prefs, maxFocusMinutes: e.target.value })}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1"
              aria-label="Max focus minutes per day"
            />
            min/day
          </label>
        </div>
      </section>

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
