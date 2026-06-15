import { RosterEntry } from "@/lib/debateProgress";
import { agentMeta } from "@/lib/agents";
import { ChampionSigil } from "@/components/landing/ChampionSigil";

const ACTION_LABEL: Record<string, string> = {
  proposed: "proposed ✓",
  critiqued: "critiqued",
  decided: "decided ✓",
  intervened: "intervened",
  waiting: "waiting",
};

export function CouncilRoster({ roster }: { roster: RosterEntry[] }) {
  return (
    <div className="flex flex-col gap-2.5" data-testid="council-roster">
      {roster.map((r) => {
        const meta = agentMeta(r.speaker);
        const hue = meta.hue ?? "var(--amber)";
        return (
          <div
            key={r.speaker}
            data-testid={`roster-${r.speaker}`}
            data-active={r.active}
            style={{ ["--ring-c" as string]: hue }}
            className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border p-3 transition-all duration-500 ${
              r.active
                ? "animate-roster-ignite border-transparent bg-surface"
                : "border-border bg-surface/40 opacity-70 hover:opacity-100"
            }`}
          >
            {/* Signature hue wash that surfaces when the champion is speaking. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 transition-opacity duration-500"
              style={{
                opacity: r.active ? 0.12 : 0,
                background: `radial-gradient(120% 100% at 0% 50%, ${hue}, transparent 70%)`,
              }}
            />
            {/* Crest — landing sigil at roster scale, dimmed until active. */}
            {meta.sigil ? (
              <div
                className="relative shrink-0 transition-[filter,opacity] duration-500"
                style={{
                  filter: r.active ? "saturate(1.1)" : "saturate(0.55)",
                  opacity: r.active ? 1 : 0.75,
                }}
              >
                <ChampionSigil type={meta.sigil} color={hue} size="sm" />
              </div>
            ) : (
              <span className="relative grid h-11 w-11 place-items-center text-lg" aria-hidden>
                {meta.emoji}
              </span>
            )}

            <div className="relative min-w-0 flex-1">
              <p
                className="truncate font-display text-[0.95rem] leading-tight transition-colors duration-500"
                style={{ color: r.active ? hue : undefined }}
              >
                {meta.label}
              </p>
              <p className="mt-0.5 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">
                {r.active ? "speaking…" : ACTION_LABEL[r.action]}
              </p>
            </div>

            {/* Live pulse on the speaking champion. */}
            {r.active && (
              <span
                aria-hidden
                className="relative h-2 w-2 shrink-0 animate-pulse rounded-full"
                style={{ background: hue, boxShadow: `0 0 10px ${hue}` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
