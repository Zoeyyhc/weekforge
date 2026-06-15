"use client";

import { useState } from "react";
import React from "react";
import { StartDebateRequest } from "@/lib/types";
import {
  buildRequest,
  TaskDraft,
  BusyBlockDraft,
  PrefsDraft,
  Weekday,
} from "@/lib/buildRequest";
import { TaskRow } from "@/components/TaskRow";
import { BusyBlockRow } from "@/components/BusyBlockRow";

let _draftIdCounter = 0;
function nextDraftId(): string {
  return `draft-${++_draftIdCounter}`;
}

function emptyTask(): TaskDraft {
  return {
    id: nextDraftId(),
    title: "",
    estimatedMinutes: "60",
    priority: 2,
    hasDeadline: false,
    deadlineWeekday: "Fri" as Weekday,
    preferredDays: [],
  };
}

const SEED_TASKS: TaskDraft[] = [
  {
    id: nextDraftId(),
    title: "Write Q3 report",
    estimatedMinutes: "180",
    priority: 1,
    hasDeadline: false,
    deadlineWeekday: "Fri" as Weekday,
    preferredDays: [],
  },
  {
    id: nextDraftId(),
    title: "Review 5 pull requests",
    estimatedMinutes: "90",
    priority: 2,
    hasDeadline: false,
    deadlineWeekday: "Fri" as Weekday,
    preferredDays: [],
  },
];

const SEED_BLOCKS: BusyBlockDraft[] = [
  {
    id: nextDraftId(),
    label: "Standup",
    start: "2026-06-15T10:00",
    end: "2026-06-15T11:00",
  },
];

const SEED_PREFS: PrefsDraft = {
  workdayStartHour: "9",
  workdayEndHour: "18",
  maxFocusMinutes: "360",
};

function validate(tasks: TaskDraft[], blocks: BusyBlockDraft[], prefs: PrefsDraft): string | null {
  const titled = tasks.filter((t) => t.title.trim() !== "");
  if (titled.length === 0) return "Add at least one task with a title.";
  if (titled.some((t) => !(Number(t.estimatedMinutes) > 0)))
    return "Every task needs an estimate greater than 0 minutes.";
  for (const b of blocks) {
    if (b.start && b.end && new Date(b.end) <= new Date(b.start))
      return "Each busy block must end after it starts.";
  }
  if (Number(prefs.workdayStartHour) >= Number(prefs.workdayEndHour))
    return "Workday start must be before end.";
  return null;
}

function ForgeCard({
  children,
  barClass,
}: {
  children: React.ReactNode;
  barClass: string;
}) {
  return (
    <div className="flex rounded-xl bg-[#1c2030] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className={`w-1 self-stretch rounded-l-xl shrink-0 ${barClass}`} aria-hidden="true" />
      <div className="flex-1 p-4 flex flex-col gap-3">{children}</div>
    </div>
  );
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
    const err = validate(tasks, blocks, prefs);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const titledTasks = tasks.filter((t) => t.title.trim() !== "");
    const populatedBlocks = blocks.filter((b) => b.start !== "" && b.end !== "");
    onStart(buildRequest(titledTasks, populatedBlocks, prefs));
  }

  return (
    <div className="flex flex-col gap-4" data-testid="task-form">

      {/* ── Tasks card ── */}
      <ForgeCard barClass="bg-gradient-to-b from-rose-400 to-ember">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
            ⚔ Tasks
          </h2>
          <button
            type="button"
            data-testid="add-task-btn"
            onClick={() => setTasks((prev) => [...prev, emptyTask()])}
            className="text-xs font-medium text-ember underline hover:text-amber transition-colors"
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
      </ForgeCard>

      {/* ── Busy Blocks card ── */}
      <ForgeCard barClass="bg-gradient-to-b from-cyan-400 to-indigo-500">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
            🗓 Busy Blocks
          </h2>
          <button
            type="button"
            data-testid="add-block-btn"
            onClick={() =>
              setBlocks((prev) => [
                ...prev,
                { id: nextDraftId(), label: "", start: "", end: "" },
              ])
            }
            className="text-xs font-medium text-ember underline hover:text-amber transition-colors"
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
      </ForgeCard>

      {/* ── Preferences card ── */}
      <ForgeCard barClass="bg-gradient-to-b from-emerald-400 to-cyan-400">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          ⚙ Preferences
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[#2a2620] bg-[#111318] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">
              🕘 Start
            </div>
            <input
              data-testid="pref-start"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayStartHour}
              onChange={(e) => setPrefs((prev) => ({ ...prev, workdayStartHour: e.target.value }))}
              className="w-full bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none font-mono text-lg font-bold text-foreground py-1 transition-colors"
              aria-label="Workday start hour"
            />
          </div>
          <div className="rounded-lg border border-[#2a2620] bg-[#111318] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">
              🕕 End
            </div>
            <input
              data-testid="pref-end"
              type="number"
              min={0}
              max={23}
              value={prefs.workdayEndHour}
              onChange={(e) => setPrefs((prev) => ({ ...prev, workdayEndHour: e.target.value }))}
              className="w-full bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none font-mono text-lg font-bold text-foreground py-1 transition-colors"
              aria-label="Workday end hour"
            />
          </div>
          <div className="rounded-lg border border-[#2a2620] bg-[#111318] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">
              🎯 Max Focus
            </div>
            <div className="flex items-baseline gap-1">
              <input
                data-testid="pref-focus"
                type="number"
                min={0}
                value={prefs.maxFocusMinutes}
                onChange={(e) => setPrefs((prev) => ({ ...prev, maxFocusMinutes: e.target.value }))}
                className="w-full bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none font-mono text-lg font-bold text-foreground py-1 transition-colors"
                aria-label="Max focus minutes per day"
              />
              <span className="font-mono text-xs text-muted shrink-0">min</span>
            </div>
          </div>
        </div>
      </ForgeCard>

      {error && (
        <p className="text-sm text-rose-300" data-testid="form-error">
          {error}
        </p>
      )}

      {/* ── Ember separator + CTA ── */}
      <div className="border-t border-ember/20 pt-4">
        <button
          type="button"
          onClick={handleStart}
          disabled={disabled}
          className="w-full rounded-xl bg-gradient-to-br from-ember to-amber px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-[#1a0e00] shadow-[0_4px_24px_rgba(255,107,53,0.35)] hover:shadow-[0_4px_32px_rgba(255,107,53,0.5)] transition-shadow disabled:opacity-50"
        >
          ⚒ Convene the Council
        </button>
      </div>
    </div>
  );
}
