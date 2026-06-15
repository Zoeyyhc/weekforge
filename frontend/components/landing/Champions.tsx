import { ChampionSigil, type SigilType } from "@/components/landing/ChampionSigil";
import { Reveal } from "@/components/landing/Reveal";

interface Champion {
  type: SigilType;
  color: string;
  name: string;
  role: string;
  creed: string; // the belief that drives them, in their own voice
  goal: string;
}

const CHAMPIONS: Champion[] = [
  {
    type: "hawk",
    color: "var(--hawk)",
    name: "Deadline Hawk",
    role: "The Zealot of Urgency",
    creed: "Optimism is how projects die. Missing a deadline is the worst outcome there is — so the clock wins every argument.",
    goal: "Hit every deadline",
  },
  {
    type: "guardian",
    color: "var(--guardian)",
    name: "Energy Guardian",
    role: "The Keeper of Pace",
    creed: "Rest is as productive as work. Sprinting burns people out — so I will always push back on an overpacked week.",
    goal: "Protect against burnout",
  },
  {
    type: "batcher",
    color: "var(--batcher)",
    name: "Focus Batcher",
    role: "The Deep-Work Purist",
    creed: "Fragmentation is the enemy of great work. Cluster the meetings, batch the like with the like, and guard the long blocks.",
    goal: "Minimise context-switching",
  },
  {
    type: "arbiter",
    color: "var(--arbiter)",
    name: "The Arbiter",
    role: "The Neutral Mediator",
    creed: "Three truths, one schedule. I weigh every claim in the open — and I always tell you which trade-offs I accepted.",
    goal: "Balance the verdict",
  },
];

function ChampionCard({ c, delay }: { c: Champion; delay: number }) {
  return (
    <Reveal as="li" delay={delay}>
      <article
        className="champion-card group relative flex h-full flex-col items-start gap-5 overflow-hidden rounded-2xl border border-border bg-surface/60 p-7 backdrop-blur-sm"
        style={{ ["--c" as string]: c.color }}
      >
        {/* Top ignite accent line. */}
        <span
          aria-hidden
          className="champion-accent absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${c.color}, transparent)` }}
        />

        <ChampionSigil type={c.type} color={c.color} />

        <div>
          <h3 className="font-display text-2xl font-medium leading-tight">
            {c.name}
          </h3>
          <p
            className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em]"
            style={{ color: c.color }}
          >
            {c.role}
          </p>
        </div>

        <p className="text-balance text-sm leading-relaxed text-muted">
          “{c.creed}”
        </p>

        <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-foreground/70">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }}
          />
          <span className="font-medium">{c.goal}</span>
        </div>
      </article>
    </Reveal>
  );
}

export function Champions() {
  return (
    <section id="champions" className="relative mx-auto max-w-6xl px-6 py-28">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.42em] text-amber/80">
          The council
        </p>
        <h2 className="mt-5 font-display text-[clamp(2.2rem,6vw,4rem)] font-light leading-[1.02] tracking-[-0.02em]">
          Four minds, <span className="italic text-foreground/90">one week.</span>
        </h2>
        <p className="mt-5 text-balance text-muted">
          Each champion fights for a single, non-negotiable objective. They
          propose. They critique. They clash — and out of the friction, a real
          schedule is forged.
        </p>
      </Reveal>

      <ul className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {CHAMPIONS.map((c, i) => (
          <ChampionCard key={c.type} c={c} delay={0.08 * i} />
        ))}
      </ul>
    </section>
  );
}
