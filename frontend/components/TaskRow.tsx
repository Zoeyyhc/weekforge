"use client";

import { useState } from "react";
import { TaskDraft, Weekday } from "@/lib/buildRequest";

const PRIORITIES = [1, 2, 3, 4, 5];

// P1 burns hottest; lower priorities cool toward ash.
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
  disabledDays = [],
  weekStart,
}: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  onRemove: () => void;
  disabledDays?: Weekday[];
  weekStart?: string;
}) {
  // The remark plate opens on demand, or stays open if it already holds text.
  const [remarkOpen, setRemarkOpen] = useState(draft.remark.trim() !== "");

  function handleDayClick(day: Weekday) {
    if (disabledDays.includes(day)) {
      return;
    }

    const idx = draft.preferredDays.indexOf(day);
    if (idx >= 0) {
      onChange({ preferredDays: draft.preferredDays.filter((d) => d !== day) });
    } else if (draft.preferredDays.length < 2) {
      onChange({ preferredDays: [...draft.preferredDays, day] });
    }
  }

  return (
    <div
      className="group/task relative overflow-hidden rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-300 focus-within:border-ember/45 hover:border-[#34303c]"
      data-testid="task-row"
    >
      {/* Molten left edge — ignites when the row is focused. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-rose-400/70 to-ember/70 opacity-40 transition-opacity duration-300 group-focus-within/task:opacity-100"
      />

      <div className="flex flex-col gap-3 p-4 pl-5">
        {/* Row 1: title · estimate · priority · remove */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            data-testid="task-title-input"
            aria-label="Task title"
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Name the work…"
            className="flex-1 border-0 border-b border-transparent bg-transparent py-1 font-display text-lg font-light tracking-tight text-foreground outline-none transition-colors placeholder:text-[#403b46] focus:border-ember/50"
          />
          <div className="flex items-baseline gap-1 rounded-lg bg-[#0c0d12] px-2.5 py-1.5 ring-1 ring-[#272430]">
            <input
              data-testid="task-minutes-input"
              type="number"
              min={1}
              value={draft.estimatedMinutes}
              onChange={(e) => onChange({ estimatedMinutes: e.target.value })}
              className="w-12 border-0 bg-transparent text-right font-mono text-sm font-semibold text-foreground outline-none"
              aria-label="Estimated minutes"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#4a4845]" aria-hidden="true">
              min
            </span>
          </div>
          <select
            data-testid="task-priority-select"
            value={draft.priority}
            onChange={(e) => onChange({ priority: Number(e.target.value) })}
            className={`rounded-lg border border-[#272430] bg-[#0c0d12] px-2.5 py-1.5 font-mono text-xs font-bold outline-none transition-colors focus:border-ember/50 ${PRIORITY_COLORS[draft.priority] ?? "text-muted"}`}
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
            className="px-1 text-lg leading-none text-[#3a3530] transition-colors hover:text-rose-400"
          >
            ✕
          </button>
        </div>

        {/* Row 2: deadline toggle + weekday + preferred days */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            aria-label="Toggle deadline"
            onClick={() => onChange({ hasDeadline: !draft.hasDeadline })}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              draft.hasDeadline
                ? "border-rose-400/60 bg-rose-950/40 text-rose-300"
                : "border-[#272430] bg-[#14161d] text-[#4a4845] hover:text-muted"
            }`}
          >
            ⏳ deadline
          </button>
          {draft.hasDeadline && (
            <select
              aria-label="Deadline weekday"
              value={draft.deadlineWeekday}
              onChange={(e) => onChange({ deadlineWeekday: e.target.value as Weekday })}
              className={`animate-inscribe border-b border-rose-400/40 bg-transparent px-1 py-0.5 font-mono text-xs outline-none ${
                weekStart && disabledDays.includes(draft.deadlineWeekday) ? "text-muted" : "text-rose-300"
              }`}
            >
              {DAYS.map((d) => (
                <option
                  key={d}
                  value={d}
                  disabled={Boolean(weekStart) && disabledDays.includes(d)}
                  className="bg-[#16191f]"
                >
                  {d}
                </option>
              ))}
            </select>
          )}

          <span aria-hidden className="hidden h-4 w-px bg-[#272430] sm:block" />

          <span className="font-mono text-[10px] uppercase tracking-wider text-[#3a3530]">
            prefer
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {DAYS.map((day) => {
              const pos = draft.preferredDays.indexOf(day);
              const isFirst = pos === 0;
              const isSecond = pos === 1;
              const isDisabled = Boolean(weekStart) && disabledDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  data-testid={`day-pill-${day}`}
                  disabled={isDisabled}
                  onClick={() => handleDayClick(day)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-all ${
                    isDisabled
                      ? "cursor-not-allowed border-[#22202a] bg-[#101219] text-[#3a3530] opacity-50"
                      : ""
                  } ${
                    isFirst
                      ? "scale-105 border-ember/60 bg-ember/30 text-ember shadow-[0_0_8px_rgba(255,107,53,0.3)]"
                      : isSecond
                      ? "border-amber/50 bg-amber/25 text-amber"
                      : "border-[#272430] bg-[#14161d] text-[#4a4845] hover:text-muted"
                  }`}
                >
                  {isFirst ? "① " : isSecond ? "② " : ""}
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 3: remark — a word to the council */}
        {!remarkOpen ? (
          <button
            type="button"
            data-testid="task-remark-toggle"
            onClick={() => setRemarkOpen(true)}
            className="self-start font-mono text-[11px] tracking-wide text-[#4a4845] transition-colors hover:text-amber"
          >
            ✎ add a word to the council
          </button>
        ) : (
          <div className="animate-inscribe rounded-lg border border-[#272430] border-l-2 border-l-amber/50 bg-[#0c0d12] px-3 py-2">
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-amber/70">
              ✎ a word to the council
            </label>
            <textarea
              data-testid="task-remark-input"
              aria-label="Remark"
              value={draft.remark}
              onChange={(e) => onChange({ remark: e.target.value })}
              rows={2}
              placeholder="Context, constraints, how you'd approach it… (a note to yourself)"
              className="w-full resize-none bg-transparent font-sans text-sm leading-relaxed text-foreground/90 outline-none placeholder:text-[#403b46]"
            />
          </div>
        )}
      </div>
    </div>
  );
}
