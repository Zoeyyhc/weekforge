"use client";

import { useState } from "react";
import { useDebateStream } from "@/lib/useDebateStream";
import { useGoogleCalendar } from "@/lib/useGoogleCalendar";
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

// Monday of the current week, as YYYY-MM-DD (used for import + export window).
function currentWeekStart(): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export default function Home() {
  const { state, maxRounds, start, intervene, reset } = useDebateStream();
  const google = useGoogleCalendar();
  const [imported, setImported] = useState<TimeBlock[]>([]);
  const weekStart = currentWeekStart();
  const showForm = state.status === "idle";
  const progress = debateProgress(state.events, maxRounds, state.status);

  async function handleImport() {
    if (google.calendars.length === 0) await google.loadCalendars();
    const blocks = await google.importWeek(weekStart);
    setImported(blocks);
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
          <button type="button" onClick={handleImport} className="text-sm font-medium text-amber underline">
            Import this week
          </button>
        )}
      </div>
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

  // Merge imported busy blocks into the request when starting.
  function handleStart(req: StartDebateRequest) {
    const importedInputs: BusyBlockInput[] = imported.map((b) => ({
      start: b.start,
      end: b.end,
      label: b.label,
    }));
    start({ ...req, busy_blocks: [...(req.busy_blocks ?? []), ...importedInputs] });
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
                    onExport={() => exportSchedule(`${weekStart}T00:00:00+00:00`, state.schedule!.blocks)}
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
            <DebateTimeline events={state.events} />
          </section>
        </div>
      )}
    </main>
  );
}
