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
import { IntakePanel, INTAKE_STEPS } from "@/components/IntakePanel";

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
    remark: "",
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
    remark: "",
  },
  {
    id: nextDraftId(),
    title: "Review 5 pull requests",
    estimatedMinutes: "90",
    priority: 2,
    hasDeadline: false,
    deadlineWeekday: "Fri" as Weekday,
    preferredDays: [],
    remark: "",
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

// ── Per-step validation. Each returns an error string, or null when the step
//    is sound enough to advance. The full check runs again at Convene. ──
function validateTasks(tasks: TaskDraft[]): string | null {
  const titled = tasks.filter((t) => t.title.trim() !== "");
  if (titled.length === 0) return "Add at least one task with a title.";
  if (titled.some((t) => !(Number(t.estimatedMinutes) > 0)))
    return "Every task needs an estimate greater than 0 minutes.";
  return null;
}
function validateBlocks(blocks: BusyBlockDraft[]): string | null {
  for (const b of blocks) {
    if (b.start && b.end && new Date(b.end) <= new Date(b.start))
      return "Each busy block must end after it starts.";
  }
  return null;
}
function validatePrefs(prefs: PrefsDraft): string | null {
  if (Number(prefs.workdayStartHour) >= Number(prefs.workdayEndHour))
    return "Workday start must be before end.";
  return null;
}

// ── A consistent header for each step on the right column. ──
function StepHeader({
  index,
  title,
  subtitle,
}: {
  index: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-amber/80">
        Step {INTAKE_STEPS[index].numeral} · {INTAKE_STEPS.length}
      </p>
      <h2 className="mt-2 font-display text-[clamp(1.5rem,3.5vw,2rem)] font-light leading-tight tracking-tight">
        {title}
      </h2>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{subtitle}</p>
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
  const [step, setStep] = useState(0);

  function patchTask(i: number, patch: Partial<TaskDraft>) {
    setTasks((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function patchBlock(i: number, patch: Partial<BusyBlockDraft>) {
    setBlocks((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  function checkStep(i: number): string | null {
    if (i === 0) return validateTasks(tasks);
    if (i === 1) return validateBlocks(blocks);
    return validatePrefs(prefs);
  }

  function goNext() {
    const err = checkStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, INTAKE_STEPS.length - 1));
  }
  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }
  // Jumping via the rail is forgiving — no forward gate, just clear stale errors.
  function jumpTo(i: number) {
    setError(null);
    setStep(i);
  }

  function handleStart() {
    const err = validateTasks(tasks) ?? validateBlocks(blocks) ?? validatePrefs(prefs);
    if (err) {
      // Surface the error on the step that owns it.
      if (validateTasks(tasks)) setStep(0);
      else if (validateBlocks(blocks)) setStep(1);
      setError(err);
      return;
    }
    setError(null);
    const titledTasks = tasks.filter((t) => t.title.trim() !== "");
    const populatedBlocks = blocks.filter((b) => b.start !== "" && b.end !== "");
    onStart(buildRequest(titledTasks, populatedBlocks, prefs));
  }

  const summoned = tasks.filter((t) => t.title.trim() !== "").length;
  const blocksMarked = blocks.filter((b) => b.start !== "" && b.end !== "").length;
  const isLast = step === INTAKE_STEPS.length - 1;

  return (
    <div data-testid="task-form" className="grid gap-6 md:grid-cols-[19rem_1fr] md:items-start">
      {/* ── Left rail: immersive council panel (desktop, sticky) ── */}
      <aside className="hidden md:block">
        <div className="md:sticky md:top-8">
          <IntakePanel
            step={step}
            onStepSelect={jumpTo}
            summoned={summoned}
            blocks={blocksMarked}
          />
        </div>
      </aside>

      {/* ── Mobile: condensed step strip ── */}
      <div className="flex items-center gap-2 md:hidden">
        {INTAKE_STEPS.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => jumpTo(i)}
            className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
              i === step
                ? "border-ember/60 bg-ember/10"
                : i < step
                ? "border-ember/30 bg-[#14161d]"
                : "border-[#272430] bg-[#0c0d12]"
            }`}
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold ${
                i === step ? "bg-ember/25 text-amber" : "text-muted"
              }`}
            >
              {i < step ? "✓" : s.numeral}
            </span>
            <span className={`truncate text-[11px] font-semibold ${i === step ? "text-foreground" : "text-muted"}`}>
              {s.title}
            </span>
          </button>
        ))}
      </div>

      {/* ── Right column: the active step ── */}
      <section>
        <div key={step} className="animate-step-in flex flex-col gap-5">
          {step === 0 && (
            <>
              <StepHeader
                index={0}
                title="Summon your work."
                subtitle="Hand the council every task — set the weight, the priority, and a word on why it matters."
              />
              <div className="flex flex-col gap-3">
                {tasks.map((t, i) => (
                  <TaskRow
                    key={t.id}
                    draft={t}
                    onChange={(patch) => patchTask(i, patch)}
                    onRemove={() => setTasks((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
                <button
                  type="button"
                  data-testid="add-task-btn"
                  onClick={() => setTasks((prev) => [...prev, emptyTask()])}
                  className="self-start rounded-lg border border-dashed border-[#34303c] px-4 py-2 text-sm font-medium text-ember transition-colors hover:border-ember/50 hover:bg-ember/[0.06]"
                >
                  + Summon another task
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <StepHeader
                index={1}
                title="Mark the immovable."
                subtitle="The hours that cannot bend. Bind your calendar to import them, or inscribe them by hand."
              />
              {googleSlot}
              <div className="flex flex-col gap-3">
                {blocks.map((b, i) => (
                  <BusyBlockRow
                    key={b.id}
                    draft={b}
                    onChange={(patch) => patchBlock(i, patch)}
                    onRemove={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
                <button
                  type="button"
                  data-testid="add-block-btn"
                  onClick={() =>
                    setBlocks((prev) => [
                      ...prev,
                      { id: nextDraftId(), label: "", start: "", end: "" },
                    ])
                  }
                  className="self-start rounded-lg border border-dashed border-[#34303c] px-4 py-2 text-sm font-medium text-batcher transition-colors hover:border-batcher/50 hover:bg-batcher/[0.06]"
                >
                  + Mark another hour
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <StepHeader
                index={2}
                title="Set your rhythm."
                subtitle="When the workday opens and closes, and how long you can hold deep focus before the fire must cool."
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <PrefCard label="🕘 Start" hint="hour">
                  <input
                    data-testid="pref-start"
                    type="number"
                    min={0}
                    max={23}
                    value={prefs.workdayStartHour}
                    onChange={(e) => setPrefs((p) => ({ ...p, workdayStartHour: e.target.value }))}
                    className="w-full border-0 border-b border-[#272430] bg-transparent py-1 font-mono text-2xl font-bold text-foreground outline-none transition-colors focus:border-ember"
                    aria-label="Workday start hour"
                  />
                </PrefCard>
                <PrefCard label="🕕 End" hint="hour">
                  <input
                    data-testid="pref-end"
                    type="number"
                    min={0}
                    max={23}
                    value={prefs.workdayEndHour}
                    onChange={(e) => setPrefs((p) => ({ ...p, workdayEndHour: e.target.value }))}
                    className="w-full border-0 border-b border-[#272430] bg-transparent py-1 font-mono text-2xl font-bold text-foreground outline-none transition-colors focus:border-ember"
                    aria-label="Workday end hour"
                  />
                </PrefCard>
                <PrefCard label="🎯 Max Focus" hint="min / day">
                  <input
                    data-testid="pref-focus"
                    type="number"
                    min={0}
                    value={prefs.maxFocusMinutes}
                    onChange={(e) => setPrefs((p) => ({ ...p, maxFocusMinutes: e.target.value }))}
                    className="w-full border-0 border-b border-[#272430] bg-transparent py-1 font-mono text-2xl font-bold text-foreground outline-none transition-colors focus:border-ember"
                    aria-label="Max focus minutes per day"
                  />
                </PrefCard>
              </div>
            </>
          )}

          {error && (
            <p
              className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-300"
              data-testid="form-error"
            >
              {error}
            </p>
          )}

          {/* ── Navigation / Convene ── */}
          <div className="flex items-center gap-3 border-t border-ember/15 pt-5">
            {step > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="rounded-lg border border-[#34303c] px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:border-[#4a4845] hover:text-foreground"
              >
                ← Back
              </button>
            )}

            {!isLast ? (
              <button
                type="button"
                onClick={goNext}
                className="ml-auto rounded-lg border border-ember/40 bg-ember/[0.08] px-5 py-2.5 text-sm font-semibold text-amber transition-colors hover:border-ember/70 hover:bg-ember/15"
              >
                Next · {INTAKE_STEPS[step + 1].title} →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={disabled}
                className="group ml-auto flex-1 rounded-xl bg-gradient-to-br from-ember to-amber px-6 py-3.5 text-sm font-black uppercase tracking-[0.2em] text-[#1a0e00] shadow-[0_4px_24px_rgba(255,107,53,0.35)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_6px_40px_rgba(255,107,53,0.55)] disabled:opacity-50 disabled:hover:translate-y-0 sm:flex-none"
              >
                <span className="inline-block transition-transform duration-300 group-hover:rotate-[-8deg]">
                  ⚒
                </span>{" "}
                Convene the Council
              </button>
            )}
          </div>

          {isLast && (
            <p className="text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
              four minds enter · one week is forged
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function PrefCard({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-[#4a4845]">{hint}</span>
      </div>
      {children}
    </div>
  );
}
