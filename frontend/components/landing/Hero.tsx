import Link from "next/link";

// The opening statement. Oversized Fraunces wordmark with an expressive italic
// on "forged", staggered entrance, and ember-glowing primary CTA into the app.
export function Hero() {
  return (
    <section className="relative mx-auto flex min-h-[92vh] max-w-5xl flex-col items-center justify-center px-6 text-center">
      {/* Eyebrow */}
      <p
        className="animate-forge-in mb-8 font-mono text-xs uppercase tracking-[0.42em] text-amber/80"
        style={{ animationDelay: "0.05s" }}
      >
        A council convenes
      </p>

      {/* Wordmark / headline */}
      <h1 className="font-display text-[clamp(3.2rem,12vw,9rem)] font-light leading-[0.92] tracking-[-0.02em]">
        <span
          className="animate-forge-in block"
          style={{ animationDelay: "0.12s" }}
        >
          Your week,
        </span>
        <span
          className="animate-forge-in block italic"
          style={{
            animationDelay: "0.28s",
            background:
              "linear-gradient(180deg, var(--amber), var(--ember) 70%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            textShadow: "0 0 60px rgba(255,107,53,0.25)",
          }}
        >
          forged in debate.
        </span>
      </h1>

      {/* Subhead */}
      <p
        className="animate-forge-in mt-8 max-w-xl text-balance text-lg leading-relaxed text-muted"
        style={{ animationDelay: "0.44s" }}
      >
        Three opinionated AI agents argue, live, over how to plan your week — a
        deadline zealot, a burnout guardian, and a deep-work purist. A neutral
        arbiter forges the verdict. When they stall,{" "}
        <span className="text-foreground">you</span> break the tie.
      </p>

      {/* CTAs */}
      <div
        className="animate-forge-in mt-11 flex flex-col items-center gap-4 sm:flex-row"
        style={{ animationDelay: "0.6s" }}
      >
        <Link
          href="/app"
          className="group relative inline-flex items-center gap-2 rounded-full bg-ember px-8 py-3.5 text-sm font-semibold text-background shadow-[0_0_0_0_rgba(255,107,53,0.5)] transition-all duration-300 hover:shadow-[0_0_36px_4px_rgba(255,107,53,0.45)]"
        >
          Convene the council
          <span className="transition-transform duration-300 group-hover:translate-x-0.5">
            →
          </span>
        </Link>
        <a
          href="#champions"
          className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3.5 text-sm font-medium text-foreground/80 transition-colors hover:border-amber/50 hover:text-foreground"
        >
          Meet the four minds
        </a>
      </div>

      {/* Scroll hint */}
      <div
        className="animate-forge-in absolute bottom-8 left-1/2 -translate-x-1/2"
        style={{ animationDelay: "0.9s" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted/60">
          scroll
        </span>
      </div>
    </section>
  );
}
