"use client";

import { useState, useEffect, useRef } from "react";
import { defaultWeekMonday, toISODate, toLocalMidnightISO } from "@/lib/weekWindow";
import { useDebateStream } from "@/lib/useDebateStream";
import { useGoogleCalendar } from "@/lib/useGoogleCalendar";
import { useFreshActivity } from "@/lib/useFreshActivity";
import { debateProgress } from "@/lib/debateProgress";
import { TaskForm } from "@/components/TaskForm";
import { ForgeLogo } from "@/components/ForgeLogo";
import { AppAtmosphere } from "@/components/AppAtmosphere";
import { ForgedModal } from "@/components/ForgedModal";
import { DebateTimeline } from "@/components/DebateTimeline";
import { DebateStatusBand } from "@/components/DebateStatusBand";
import { CouncilRoster } from "@/components/CouncilRoster";
import { InterventionPanel } from "@/components/InterventionPanel";
import { WeekCalendar } from "@/components/WeekCalendar";
import { ExportButton } from "@/components/ExportButton";
import { GoogleConnect } from "@/components/GoogleConnect";
import { CalendarPicker } from "@/components/CalendarPicker";
import { ImportPreview } from "@/components/ImportPreview";
import { DebateStatus } from "@/lib/debateReducer";
import { googleLoginUrl, exportSchedule } from "@/lib/api";
import { BusyBlockInput, TimeBlock, StartDebateRequest } from "@/lib/types";

const STATUS_LABEL: Record<DebateStatus, string> = {
  idle: "Ready",
  streaming: "Debating…",
  interrupted: "Awaiting you",
  done: "Decided",
  error: "Error",
};

export default function Home() {
  const { state, maxRounds, start, intervene, reset } = useDebateStream();
  const google = useGoogleCalendar();
  const [imported, setImported] = useState<TimeBlock[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [weekStart, setWeekStart] = useState(() =>
    toISODate(defaultWeekMonday(new Date(), 18)),
  );
  const latestWeekStartRef = useRef(weekStart);
  const importRequestIdRef = useRef(0);
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

  useEffect(() => {
    latestWeekStartRef.current = weekStart;
    importRequestIdRef.current += 1;
    setImported([]);
    setImportDone(false);
    setImportError(null);
    setImporting(false);
  }, [weekStart]);

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

  async function handleImport() {
    const requestWeekStart = weekStart;
    const requestId = importRequestIdRef.current + 1;
    importRequestIdRef.current = requestId;
    setImporting(true);
    setImportError(null);
    setImportDone(false);
    try {
      if (google.calendars.length === 0) await google.loadCalendars();
      const blocks = await google.importWeek(toLocalMidnightISO(requestWeekStart));
      if (
        importRequestIdRef.current === requestId &&
        latestWeekStartRef.current === requestWeekStart
      ) {
        setImported(blocks);
        setImportDone(true);
      }
    } catch (err) {
      if (
        importRequestIdRef.current === requestId &&
        latestWeekStartRef.current === requestWeekStart
      ) {
        setImportError(
          err instanceof Error ? err.message : "Could not import from Google Calendar.",
        );
      }
    } finally {
      if (importRequestIdRef.current === requestId) {
        setImporting(false);
      }
    }
  }

  const googleSlot = (
    <div className="flex flex-col gap-3 rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GoogleConnect
          connected={google.connected}
          loginUrl={googleLoginUrl()}
          onDisconnect={google.disconnect}
        />
        {google.connected && (
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="rounded-lg border border-guardian/40 bg-guardian/[0.08] px-3.5 py-2 text-sm font-semibold text-guardian transition-colors hover:border-guardian/70 hover:bg-guardian/15 disabled:opacity-50"
          >
            {importing ? "Importing…" : "↓ Import this week"}
          </button>
        )}
      </div>
      {importError && (
        <p className="text-sm text-rose-300" data-testid="import-error">
          {importError}
        </p>
      )}
      {importDone && imported.length === 0 && !importError && (
        <p className="text-sm text-muted" data-testid="import-empty">
          No events found for the week of {weekStart}.
        </p>
      )}
      {google.connected && google.calendars.length > 0 && (
        <CalendarPicker
          calendars={google.calendars}
          selectedIds={google.selectedIds}
          onToggle={google.toggleCalendar}
        />
      )}
      {imported.length > 0 && (
        <ImportPreview blocks={imported} onRemove={(i) => setImported((p) => p.filter((_, j) => j !== i))} />
      )}
    </div>
  );

  // Merge imported busy blocks and the current week into the request when starting.
  function handleStart(req: StartDebateRequest) {
    const importedInputs: BusyBlockInput[] = imported.map((b) => ({
      start: b.start,
      end: b.end,
      label: b.label,
    }));
    start({ ...req, week_start: weekStart, busy_blocks: [...(req.busy_blocks ?? []), ...importedInputs] });
  }

  // ── Login gate ─────────────────────────────────────────────────────────────
  if (!google.statusKnown) return null;

  if (!google.connected) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-4">
        <AppAtmosphere />
        <div className="flex flex-col items-center gap-8 text-center">
          <ForgeLogo size="lg" href="/" />
          <div>
            <h2 className="font-display text-3xl font-light tracking-tight">
              The council awaits your calendar.
            </h2>
            <p className="mt-3 text-sm text-muted">
              Connect Google Calendar to convene the council and forge your week.
            </p>
          </div>
          <a
            href={googleLoginUrl()}
            className="inline-flex items-center gap-2 rounded-xl bg-ember px-7 py-3.5 text-sm font-semibold text-background shadow-[0_0_0_0_rgba(255,107,53,0.5)] transition-all duration-300 hover:shadow-[0_0_36px_4px_rgba(255,107,53,0.45)]"
          >
            Sign in with Google →
          </a>
        </div>
      </main>
    );
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
          googleSlot={googleSlot}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
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
                {google.connected && (
                  <ExportButton
                    onExport={() => exportSchedule(toLocalMidnightISO(weekStart), editedBlocks)}
                  />
                )}
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
            {state.interrupt && state.status === "interrupted" && (
              <InterventionPanel interrupt={state.interrupt} onSubmit={intervene} />
            )}
            <DebateTimeline events={state.events} status={state.status} />
          </section>
        </div>
      )}

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
