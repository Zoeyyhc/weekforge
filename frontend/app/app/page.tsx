"use client";

import { useState, useEffect, useRef } from "react";
import { defaultWeekMonday, toISODate, toLocalMidnightISO } from "@/lib/weekWindow";
import { useDebateStream } from "@/lib/useDebateStream";
import { useFreshActivity } from "@/lib/useFreshActivity";
import { debateProgress } from "@/lib/debateProgress";
import { TaskForm } from "@/components/TaskForm";
import { ForgeLogo } from "@/components/ForgeLogo";
import { AppAtmosphere } from "@/components/AppAtmosphere";
import { ForgedModal } from "@/components/ForgedModal";
import { HeraldModal } from "@/components/HeraldModal";
import { DebateTimeline } from "@/components/DebateTimeline";
import { DebateStatusBand } from "@/components/DebateStatusBand";
import { CouncilRoster } from "@/components/CouncilRoster";
import { InterventionPanel } from "@/components/InterventionPanel";
import { WeekCalendar } from "@/components/WeekCalendar";
import { ExportButton } from "@/components/ExportButton";
import { DebateStatus } from "@/lib/debateReducer";
import { exportIcs } from "@/lib/api";
import { TimeBlock, StartDebateRequest, InterruptMsg } from "@/lib/types";

const STATUS_LABEL: Record<DebateStatus, string> = {
  idle: "Ready",
  streaming: "Debating…",
  interrupted: "Awaiting you",
  done: "Decided",
  error: "Error",
};

export default function Home() {
  const { state, maxRounds, start, intervene, reset } = useDebateStream();
  const [weekStart, setWeekStart] = useState(() =>
    toISODate(defaultWeekMonday(new Date(), 18)),
  );
  const latestWeekStartRef = useRef(weekStart);
  const showForm = state.status === "idle";

  // Celebrate the verdict exactly once per debate. Fires when the stream lands
  // on "done"; the flag resets when the user starts over (status → idle).
  const [showForged, setShowForged] = useState(false);
  const forgedShownRef = useRef(false);
  useEffect(() => {
    if (state.status === "done" && !forgedShownRef.current) {
      forgedShownRef.current = true;
      setShowForged(true);
    } else if (state.status === "idle") {
      forgedShownRef.current = false;
      setShowForged(false);
    }
  }, [state.status]);
  // The Herald rises to summarise the divided council whenever the debate
  // interrupts for your ruling. Dismissing it ("read the full debate") records
  // which interrupt was waved off, so a fresh interrupt re-summons the Herald
  // without an effect.
  const [dismissedInterrupt, setDismissedInterrupt] =
    useState<InterruptMsg | null>(null);
  const heraldOpen =
    state.status === "interrupted" &&
    !!state.interrupt &&
    state.interrupt !== dismissedInterrupt;

  // A speaker is "live" only briefly after their event; during the silent
  // convergence/arbiter gaps the band/roster fall back to "deliberating…".
  const speakingActive = useFreshActivity(state.events.length, 3500);
  const progress = debateProgress(state.events, maxRounds, state.status, speakingActive);

  // ── Editable copy of the forged schedule ──────────────────────────────────
  const [editedBlocks, setEditedBlocks] = useState<TimeBlock[]>([]);

  useEffect(() => {
    if (state.status === "done" && state.schedule) {
      setEditedBlocks(state.schedule.blocks.filter((b) => b.task_id !== null));
    } else if (state.status === "idle") {
      setEditedBlocks([]);
    }
  }, [state.status, state.schedule]);

  function handleWeekChange(nextWeekStart: string) {
    if (nextWeekStart === latestWeekStartRef.current) {
      return;
    }
    latestWeekStartRef.current = nextWeekStart;
    setWeekStart(nextWeekStart);
  }

  function handleEditTime(blockIndex: number, field: "start" | "end", timeStr: string) {
    setEditedBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        const base = new Date(b[field]);
        const [h, m] = timeStr.split(":").map(Number);
        base.setHours(h, m, 0, 0);
        const updated = base.toISOString();
        const newBlock = { ...b, [field]: updated };
        if (new Date(newBlock.end).getTime() <= new Date(newBlock.start).getTime()) return b;
        return newBlock;
      }),
    );
  }

  function handleDeleteBlock(blockIndex: number) {
    setEditedBlocks((prev) => prev.filter((_, i) => i !== blockIndex));
  }

  function handleStart(req: StartDebateRequest) {
    start({ ...req, week_start: weekStart });
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <AppAtmosphere />
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="leading-none">
            <ForgeLogo size="lg" href="/" />
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
            forge your week in the crucible
          </p>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
          {STATUS_LABEL[state.status]}
        </span>
      </header>

      {showForm && (
        <TaskForm
          onStart={handleStart}
          weekStart={weekStart}
          onWeekChange={handleWeekChange}
        />
      )}

      {!showForm && (
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Left rail: council + forged week */}
          <aside className="flex w-full flex-col gap-5 md:w-72 md:shrink-0">
            <div className="flex flex-col gap-2.5">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.32em] text-amber/80">
                ⚒ The council
              </h2>
              <CouncilRoster roster={progress.roster} />
            </div>
            {state.schedule && state.status === "done" && (
              <div className="flex flex-col gap-2.5">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.32em] text-amber/80">
                  ⚒ The forged week
                </h2>
                <WeekCalendar
                  schedule={{ ...state.schedule, blocks: editedBlocks }}
                  onEditTime={handleEditTime}
                  onDelete={handleDeleteBlock}
                />
                <ExportButton
                  onExport={() => exportIcs(toLocalMidnightISO(weekStart), editedBlocks)}
                />
              </div>
            )}
            <button
              onClick={reset}
              className="self-start font-mono text-[0.7rem] uppercase tracking-[0.16em] text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              ↺ Start over
            </button>
          </aside>

          {/* Right column: live debate */}
          <section className="flex w-full flex-col gap-4">
            <DebateStatusBand progress={progress} status={state.status} />
            {state.error && (
              <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">
                {state.error}
              </p>
            )}
            {state.interrupt && state.status === "interrupted" && !heraldOpen && (
              <InterventionPanel interrupt={state.interrupt} onSubmit={intervene} />
            )}
            <DebateTimeline events={state.events} status={state.status} />
          </section>
        </div>
      )}

      <HeraldModal
        open={heraldOpen}
        interrupt={state.interrupt}
        onSubmit={intervene}
        onDismiss={() => setDismissedInterrupt(state.interrupt)}
      />

      <ForgedModal
        open={showForged}
        schedule={state.schedule}
        degraded={state.degraded}
        validationWarnings={state.validationWarnings}
        onClose={() => setShowForged(false)}
      />
    </main>
  );
}
