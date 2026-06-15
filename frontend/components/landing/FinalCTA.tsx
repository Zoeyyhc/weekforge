import Link from "next/link";
import { Reveal } from "@/components/landing/Reveal";
import { ForgeLogo } from "@/components/ForgeLogo";

// Closing statement: a last ember-lit invitation into the app, plus footer.
export function FinalCTA() {
  return (
    <section className="relative px-6 pb-16 pt-12">
      <Reveal className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-ember/30 bg-surface/50 px-8 py-20 text-center backdrop-blur-sm">
        {/* Inner ember glow. */}
        <div
          aria-hidden
          className="forge-mesh animate-mesh-drift absolute inset-0 opacity-70"
        />
        <div className="relative">
          <h2 className="font-display text-[clamp(2.4rem,7vw,4.5rem)] font-light leading-[0.98] tracking-[-0.02em]">
            Stop guessing.
            <br />
            <span
              className="italic"
              style={{
                background: "linear-gradient(180deg, var(--amber), var(--ember) 70%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Convene the council.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-balance text-muted">
            Hand them your tasks and deadlines. Watch four minds fight it out.
            Walk away with a week you can actually defend.
          </p>
          <Link
            href="/app"
            className="group mt-10 inline-flex items-center gap-2 rounded-full bg-ember px-9 py-4 text-sm font-semibold text-background transition-all duration-300 hover:shadow-[0_0_40px_4px_rgba(255,107,53,0.5)]"
          >
            Forge my week
            <span className="transition-transform duration-300 group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </div>
      </Reveal>

      <footer className="mx-auto mt-16 flex max-w-6xl flex-col items-center justify-between gap-4 border-t border-border pt-8 text-xs text-muted sm:flex-row">
        <ForgeLogo size="sm" href="/" />
        <span className="font-mono tracking-wide">
          a transparent multi-agent council
        </span>
      </footer>
    </section>
  );
}
