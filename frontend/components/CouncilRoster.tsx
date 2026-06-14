import { RosterEntry } from "@/lib/debateProgress";
import { agentMeta } from "@/lib/agents";

const ACTION_LABEL: Record<string, string> = {
  proposed: "proposed ✓",
  critiqued: "critiqued",
  decided: "decided ✓",
  intervened: "intervened",
  waiting: "waiting",
};

export function CouncilRoster({ roster }: { roster: RosterEntry[] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="council-roster">
      {roster.map((r) => {
        const meta = agentMeta(r.speaker);
        return (
          <div
            key={r.speaker}
            data-testid={`roster-${r.speaker}`}
            data-active={r.active}
            className={`flex items-center gap-2 rounded-lg border p-2.5 transition ${
              r.active
                ? `${meta.ring} bg-surface shadow-[0_0_0_2px_rgba(245,166,35,0.25)]`
                : "border-border opacity-60"
            }`}
          >
            <span aria-hidden>{meta.emoji}</span>
            <span className="text-sm font-semibold">{meta.label}</span>
            <span className="ml-auto text-xs text-muted">
              {r.active ? "speaking…" : ACTION_LABEL[r.action]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
