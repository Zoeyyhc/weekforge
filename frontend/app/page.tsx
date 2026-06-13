"use client";

import { useDebateStream } from "@/lib/useDebateStream";
import { TaskForm } from "@/components/TaskForm";
import { DebateTimeline } from "@/components/DebateTimeline";
import { InterventionPanel } from "@/components/InterventionPanel";
import { ScheduleView } from "@/components/ScheduleView";
import { DebateStatus } from "@/lib/debateReducer";

const STATUS_STYLE: Record<DebateStatus, string> = {
  idle: "bg-slate-100 text-slate-700",
  streaming: "bg-blue-100 text-blue-800",
  interrupted: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
};

const STATUS_LABEL: Record<DebateStatus, string> = {
  idle: "Ready",
  streaming: "Debating…",
  interrupted: "Awaiting your call",
  done: "Decided",
  error: "Error",
};

function StatusBadge({ status }: { status: DebateStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function Home() {
  const { state, start, intervene, reset } = useDebateStream();
  const showForm = state.status === "idle";

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">WeekForge</h1>
        <p className="mt-1 text-slate-500">
          Watch a council of conflicting-objective agents debate your week — and step in as the
          final arbiter.
        </p>
      </header>

      {showForm && <TaskForm onStart={start} />}

      {!showForm && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <StatusBadge status={state.status} />
            <button onClick={reset} className="text-sm text-slate-500 underline">
              Start over
            </button>
          </div>

          {state.error && (
            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p>
          )}

          {state.interrupt && state.status === "interrupted" && (
            <InterventionPanel interrupt={state.interrupt} onSubmit={intervene} />
          )}

          {state.schedule && state.status === "done" && (
            <section>
              <h2 className="mb-3 text-xl font-semibold text-slate-900">The forged week</h2>
              <ScheduleView schedule={state.schedule} />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-xl font-semibold text-slate-900">The debate</h2>
            <DebateTimeline events={state.events} />
          </section>
        </div>
      )}
    </main>
  );
}
