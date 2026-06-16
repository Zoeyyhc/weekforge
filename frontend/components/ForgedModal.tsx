"use client";

import { useEffect, useRef, useState } from "react";
import { Schedule } from "@/lib/types";
import { ForgeSigil } from "@/components/ForgeLogo";

// Celebration modal that takes the stage when the council reaches its verdict.
// Summarises the forged week at a glance, then hands the user back to the plan
// in the sidebar. Accessible: role=dialog, Esc to dismiss, backdrop click,
// focus moved in on open and restored on close, Tab trapped within.

interface ForgedSummary {
  count: number;
  hours: number;
  days: number;
  taskBlocks: number;
}

function summarize(schedule: Schedule | null): ForgedSummary {
  const blocks = schedule?.blocks ?? [];
  let minutes = 0;
  const days = new Set<string>();
  let taskBlocks = 0;
  for (const b of blocks) {
    const ms = new Date(b.end).getTime() - new Date(b.start).getTime();
    if (Number.isFinite(ms) && ms > 0) minutes += ms / 60000;
    if (b.start) days.add(b.start.slice(0, 10));
    if (b.task_id) taskBlocks += 1;
  }
  return {
    count: blocks.length,
    hours: Math.round((minutes / 60) * 10) / 10,
    days: days.size,
    taskBlocks,
  };
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-background/60 px-3 py-4">
      <span className="font-display text-3xl font-light text-amber">{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </span>
    </div>
  );
}

export function ForgedModal({
  open,
  schedule,
  onClose,
  degraded = false,
  validationWarnings = null,
}: {
  open: boolean;
  schedule: Schedule | null;
  onClose: () => void;
  degraded?: boolean;
  validationWarnings?: string | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Focus management + key handling while open.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const s = summarize(schedule);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forged-title"
      data-testid="forged-modal"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="animate-forged-backdrop absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="animate-forged-pop relative w-full max-w-md overflow-hidden rounded-2xl border border-ember/40 bg-surface p-8 text-center shadow-[0_0_60px_-12px_rgba(255,107,53,0.6)]"
      >
        {/* Inner molten glow */}
        <div
          aria-hidden
          className="forge-mesh animate-mesh-drift pointer-events-none absolute inset-0 opacity-60"
        />

        <div className="relative">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center">
            <ForgeSigil decorative className="animate-forged h-16 w-16 rounded-full" />
          </div>

          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-amber/80">
            The council has ruled
          </p>
          <h2
            id="forged-title"
            className="mt-2 font-display text-[clamp(2rem,7vw,2.75rem)] font-light italic leading-tight"
            style={{
              background: "linear-gradient(180deg, var(--amber), var(--ember) 75%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Your week is forged.
          </h2>
          <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted">
            {degraded
              ? "The crucible couldn't satisfy every constraint — here's the closest week it could forge."
              : s.count > 0
                ? "The verdict is in. Here's what the crucible produced."
                : "The debate has concluded."}
          </p>

          {degraded && (
            <div className="mx-auto mt-5 max-w-sm rounded-xl border border-amber-500/45 bg-amber-500/10 px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,209,128,0.12)]">
              <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-amber-100/95">
                <span aria-hidden className="mt-px shrink-0 text-base leading-none text-amber-400">
                  ⚠
                </span>
                <span>
                  Some blocks may break your rules (work hours or overlaps). Review them
                  before adding to your calendar.
                </span>
              </p>
              {validationWarnings && (
                <div className="mt-2.5 pl-[26px]">
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    aria-expanded={showDetails}
                    className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-300/80 transition-colors hover:text-amber-200"
                  >
                    {showDetails ? "Hide details" : "Show details"}
                    <span
                      aria-hidden
                      className={`text-[9px] transition-transform duration-200 ${
                        showDetails ? "rotate-180" : ""
                      }`}
                    >
                      ▾
                    </span>
                  </button>
                  {showDetails && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-amber-500/20 bg-black/40 p-3 text-left font-mono text-[11px] leading-relaxed text-amber-100/75">
                      {validationWarnings}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {s.count > 0 && (
            <div className="mt-6 grid grid-cols-3 gap-2.5">
              <Stat value={s.count} label="Blocks" />
              <Stat value={s.hours} label="Hours" />
              <Stat value={s.days} label="Days" />
            </div>
          )}

          <button
            ref={primaryRef}
            type="button"
            onClick={onClose}
            data-testid="forged-view-plan"
            className="group mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-ember to-amber px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-[#1a0e00] shadow-[0_4px_24px_rgba(255,107,53,0.4)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_6px_40px_rgba(255,107,53,0.6)]"
          >
            View the forged week
            <span className="transition-transform duration-300 group-hover:translate-x-0.5">
              →
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
