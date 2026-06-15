import Link from "next/link";
import { Reveal } from "@/components/landing/Reveal";

// A faux transcript that shows the app's signature hook: a transparent,
// round-by-round argument you can read — then settle yourself.
interface Line {
  who: string;
  color: string;
  text: string;
}

const ROUND_1: Line[] = [
  {
    who: "Deadline Hawk",
    color: "var(--hawk)",
    text: "The grant draft is due Thursday 5pm. It takes Monday AND Tuesday morning — non-negotiable.",
  },
  {
    who: "Focus Batcher",
    color: "var(--batcher)",
    text: "Then move both standups off Monday. Don't shatter a deep block for a 15-minute call.",
  },
  {
    who: "Energy Guardian",
    color: "var(--guardian)",
    text: "Two writing mornings back-to-back is a burnout trap. I want a real break Tuesday afternoon.",
  },
];

const STEPS = [
  {
    k: "01",
    title: "Transparent",
    body: "No black box. Every proposal, critique, and concession streams in front of you, round by round.",
  },
  {
    k: "02",
    title: "Interactive",
    body: "When the council stalls, you step in as the final arbiter — a nudge or a hard ruling resumes the debate.",
  },
  {
    k: "03",
    title: "Forged",
    body: "The Arbiter synthesises the verdict into real time blocks — and tells you which trade-offs it accepted.",
  },
];

function Bubble({ line, delay }: { line: Line; delay: number }) {
  return (
    <Reveal delay={delay} className="flex flex-col gap-1.5">
      <span
        className="font-mono text-[11px] uppercase tracking-[0.18em]"
        style={{ color: line.color }}
      >
        {line.who}
      </span>
      <p
        className="rounded-xl rounded-tl-sm border border-border bg-background/70 px-4 py-3 text-sm leading-relaxed text-foreground/85"
        style={{ boxShadow: `inset 3px 0 0 0 ${line.color}` }}
      >
        {line.text}
      </p>
    </Reveal>
  );
}

export function HowItWorks() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 py-28">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.42em] text-amber/80">
          The fun part
        </p>
        <h2 className="mt-5 font-display text-[clamp(2.2rem,6vw,4rem)] font-light leading-[1.02] tracking-[-0.02em]">
          Watch the argument.{" "}
          <span className="italic text-foreground/90">Then settle it.</span>
        </h2>
        <p className="mt-5 text-balance text-muted">
          Most planners hand you an answer. WeekForge shows you the fight behind
          it — and lets you throw the final punch.
        </p>
      </Reveal>

      <div className="mt-16 grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Faux debate transcript. */}
        <Reveal className="relative">
          <div className="rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-sm sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
                Live · Round 1
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-ember">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ember" />
                debating
              </span>
            </div>

            <div className="flex flex-col gap-5">
              {ROUND_1.map((l, i) => (
                <Bubble key={l.who} line={l} delay={0.1 * i} />
              ))}

              {/* The intervention hook. */}
              <Reveal delay={0.36} className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
                  You · final arbiter
                </span>
                <p
                  className="rounded-xl rounded-tl-sm px-4 py-3 text-sm font-medium leading-relaxed text-foreground"
                  style={{
                    background: "rgba(245,166,35,0.10)",
                    border: "1px solid rgba(245,166,35,0.35)",
                    boxShadow: "0 0 28px -6px rgba(245,166,35,0.4)",
                  }}
                >
                  Protect Tuesday afternoon. Ship the draft by Wednesday night
                  instead — settle it.
                </p>
              </Reveal>

              {/* Forged verdict strip. */}
              <Reveal delay={0.46} className="animate-forged mt-1 rounded-xl border border-ember/40 bg-background/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span aria-hidden>⚒</span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ember">
                    Week forged
                  </span>
                </div>
                <ul className="flex flex-col gap-2 font-mono text-xs text-foreground/80">
                  <li className="flex justify-between">
                    <span>Mon 09:00 — Grant draft (deep block)</span>
                    <span className="text-muted">2h</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Tue 14:00 — Recharge · walk</span>
                    <span className="text-muted">1h</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Wed 19:00 — Grant draft · ship</span>
                    <span className="text-muted">1.5h</span>
                  </li>
                </ul>
              </Reveal>
            </div>
          </div>
        </Reveal>

        {/* The three mechanics. */}
        <ol className="flex flex-col gap-3">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.k} delay={0.1 * i}>
              <div className="group flex gap-5 rounded-2xl border border-border bg-surface/40 p-6 transition-colors hover:border-amber/40">
                <span className="font-display text-3xl font-light text-amber/70">
                  {s.k}
                </span>
                <div>
                  <h3 className="font-display text-xl font-medium">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {s.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}

          <Reveal delay={0.32} className="pt-2">
            <Link
              href="/app"
              className="group inline-flex items-center gap-2 text-sm font-semibold text-ember transition-colors hover:text-amber"
            >
              Start your own debate
              <span className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </Reveal>
        </ol>
      </div>
    </section>
  );
}
