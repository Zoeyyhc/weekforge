"use client";

import { useState } from "react";
import { useDebateStream } from "@/lib/useDebateStream";
import { useGoogleCalendar } from "@/lib/useGoogleCalendar";
import { useFreshActivity } from "@/lib/useFreshActivity";
import { debateProgress } from "@/lib/debateProgress";
import { TaskForm } from "@/components/TaskForm";
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
import { googleLoginUrl, googleDisconnectUrl, exportSchedule } from "@/lib/api";
import { BusyBlockInput, TimeBlock, StartDebateRequest } from "@/lib/types";

const STATUS_LABEL: Record<DebateStatus, string> = {
  idle: "Ready",
  streaming: "Debating…",
  interrupted: "Awaiting you",
  done: "Decided",
  error: "Error",
};

// Monday of the current week, as YYYY-MM-DD, in local time.
function currentWeekStart(): string {
  const d = mondayLocal();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// Monday of the current week at local midnight, as a full ISO 8601 string with
// the browser's UTC offset (e.g. "2026-06-15T00:00:00+10:00").
// Used for Google Calendar API calls so the query window is anchored to local
// midnight, not UTC midnight — otherwise in UTC+10 the window starts at 10 AM
// Monday and misses early-morning events.
function currentWeekStartLocal(): string {
  const d = mondayLocal();
  const off = -d.getTimezoneOffset(); // minutes ahead of UTC
  const sign = off >= 0 ? "+" : "-";
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const m = String(Math.abs(off) % 60).padStart(2, "0");
  return (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` +
    `T00:00:00${sign}${h}:${m}`
  );
}

function mondayLocal(): Date {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 0 = Monday, local time
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Home() {
  const { state, maxRounds, start, intervene, reset } = useDebateStream();
  const google = useGoogleCalendar();
  const [imported, setImported] = useState<TimeBlock[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const weekStart = currentWeekStart();
  const showForm = state.status === "idle";
  // A speaker is "live" only briefly after their event; during the silent
  // convergence/arbiter gaps the band/roster fall back to "deliberating…".
  const speakingActive = useFreshActivity(state.events.length, 3500);
  const progress = debateProgress(state.events, maxRounds, state.status, speakingActive);

  async function handleImport() {
    setImporting(true);
    setImportError(null);
    setImportDone(false);
    try {
      if (google.calendars.length === 0) await google.loadCalendars();
      const blocks = await google.importWeek(currentWeekStartLocal());
      setImported(blocks);
      setImportDone(true);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Could not import from Google Calendar.",
      );
    } finally {
      setImporting(false);
    }
  }

  const googleSlot = (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <GoogleConnect
          connected={google.connected}
          loginUrl={googleLoginUrl()}
          disconnectUrl={googleDisconnectUrl()}
        />
        {google.connected && (
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="text-sm font-medium text-amber underline disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import this week"}
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            WEEK<span className="text-ember">FORGE</span>
          </h1>
          <p className="mt-1 text-sm text-muted">forge your week in the crucible</p>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
          {STATUS_LABEL[state.status]}
        </span>
      </header>

      {showForm && <TaskForm onStart={handleStart} googleSlot={googleSlot} />}

      {!showForm && (
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Left rail: council + forged week */}
          <aside className="flex w-full flex-col gap-4 md:w-72 md:shrink-0">
            <CouncilRoster roster={progress.roster} />
            {state.schedule && state.status === "done" && (
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-amber">⚒ The forged week</h2>
                <WeekCalendar schedule={state.schedule} />
                {google.connected && (
                  <ExportButton
                    onExport={() => exportSchedule(currentWeekStartLocal(), state.schedule!.blocks)}
                  />
                )}
              </div>
            )}
            <button onClick={reset} className="self-start text-sm text-muted underline">
              Start over
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
    </main>
  );
}
