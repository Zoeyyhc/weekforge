"use client";

// The immersive left rail of the intake wizard. A sticky, ember-lit panel that
// narrates the forging ritual: a vertical "heat gauge" step rail that fills as
// the planner advances, step-specific flavor, and the four council sigils
// waiting at the foot with a live tally of what's been laid before them.

export interface IntakeStep {
  numeral: string;
  key: "tasks" | "blocks" | "rhythm";
  title: string;
  flavor: string;
}

export const INTAKE_STEPS: IntakeStep[] = [
  {
    numeral: "I",
    key: "tasks",
    title: "Summon the work",
    flavor: "Lay every task before the council — the heavy and the small alike. Add a word where it matters.",
  },
  {
    numeral: "II",
    key: "blocks",
    title: "Mark the immovable",
    flavor: "The hours that cannot bend — meetings, commitments, sworn time. The council will plan around them.",
  },
  {
    numeral: "III",
    key: "rhythm",
    title: "Set your rhythm",
    flavor: "When your day opens and closes, and how long you can hold the fire before it must cool.",
  },
];

const COUNCIL = [
  { hue: "var(--hawk)", name: "Hawk" },
  { hue: "var(--guardian)", name: "Guardian" },
  { hue: "var(--batcher)", name: "Batcher" },
  { hue: "var(--arbiter)", name: "Arbiter" },
];

export function IntakePanel({
  step,
  onStepSelect,
  summoned,
  blocks,
}: {
  step: number;
  onStepSelect: (i: number) => void;
  summoned: number;
  blocks: number;
}) {
  const last = INTAKE_STEPS.length - 1;
  // Heat rises with progress: 0% at the first step, full at the last.
  const heat = last === 0 ? 0 : (step / last) * 100;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#272430] bg-surface/60 p-6 backdrop-blur-sm">
      {/* Inner molten glow, held back so text stays crisp. */}
      <div aria-hidden className="forge-mesh animate-mesh-drift absolute inset-0 opacity-30" />

      <div className="relative">
        <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-amber/80">
          The crucible
        </p>
        <h2 className="mt-2 font-display text-2xl font-light leading-tight tracking-tight text-foreground">
          Brief the council
        </h2>

        {/* Vertical heat-gauge step rail. */}
        <div className="relative mt-7">
          {/* Track + fill, centered on the 28px node column. */}
          <div aria-hidden className="absolute left-[13px] top-3 bottom-3 w-px bg-[#272430]" />
          <div
            aria-hidden
            className="absolute left-[13px] top-3 w-px bg-gradient-to-b from-amber via-ember to-ember transition-[height] duration-700 ease-out"
            style={{ height: `calc((100% - 1.5rem) * ${heat / 100})`, boxShadow: "0 0 8px var(--ember)" }}
          />

          <ol className="relative flex flex-col gap-6">
            {INTAKE_STEPS.map((s, i) => {
              const isActive = i === step;
              const isDone = i < step;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => onStepSelect(i)}
                    aria-current={isActive ? "step" : undefined}
                    className="group/step flex w-full items-start gap-3.5 text-left"
                  >
                    <span
                      className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-xs font-bold transition-all duration-300 ${
                        isActive
                          ? "border-ember bg-ember/20 text-amber shadow-[0_0_14px_-2px_var(--ember)]"
                          : isDone
                          ? "border-ember/50 bg-ember/10 text-ember"
                          : "border-[#34303c] bg-[#0c0d12] text-[#4a4845] group-hover/step:border-[#4a4845]"
                      }`}
                    >
                      {isDone ? "✓" : s.numeral}
                    </span>
                    <span className="flex flex-col">
                      <span
                        className={`text-sm font-semibold transition-colors ${
                          isActive ? "text-foreground" : isDone ? "text-foreground/70" : "text-muted"
                        }`}
                      >
                        {s.title}
                      </span>
                      {isActive && (
                        <span className="animate-inscribe mt-1.5 text-xs leading-relaxed text-muted">
                          {s.flavor}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* The council awaits — sigils + live tally. */}
        <div className="mt-8 border-t border-[#272430] pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted/80">
            The council awaits
          </p>
          <div className="mt-3 flex items-center gap-2.5">
            {COUNCIL.map((c) => (
              <span
                key={c.name}
                title={c.name}
                className="relative grid h-8 w-8 place-items-center rounded-full border"
                style={{ borderColor: `color-mix(in oklab, ${c.hue} 35%, transparent)` }}
              >
                <span
                  aria-hidden
                  className="animate-aura absolute inset-0 rounded-full blur-md"
                  style={{ background: `radial-gradient(circle, ${c.hue}, transparent 70%)`, opacity: 0.4 }}
                />
                <span
                  className="relative h-2 w-2 rounded-full"
                  style={{ background: c.hue, boxShadow: `0 0 8px ${c.hue}` }}
                />
              </span>
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">
            <span className="text-amber">{summoned}</span>{" "}
            {summoned === 1 ? "task" : "tasks"} laid before them
            {blocks > 0 && (
              <>
                {" · "}
                <span className="text-batcher">{blocks}</span>{" "}
                {blocks === 1 ? "hour" : "hours"} held
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
