import Link from "next/link";

// ─────────────────────────────────────────────────────────────
// WeekForge brand mark.
//
// The sigil is a bespoke anvil with a rising spark, drawn in the same
// visual family as the champion crests (viewBox 0 0 100 100, round joins)
// but filled with the signature ember→amber gradient so it stays legible
// at favicon size. Pair it with the Fraunces wordmark — "Week" in the
// foreground, "Forge" in an expressive ember italic — to echo the landing
// hero exactly. One component, scaled via `size`, used in both the marketing
// nav and the app header so the logo reads identically everywhere.
// ─────────────────────────────────────────────────────────────

// Stable gradient id. Duplicated across instances is fine — SVG resolves to
// the first definition, and every instance paints the same hue.
const GRAD_ID = "forge-sigil-grad";

export function ForgeSigil({
  className,
  title = "WeekForge",
  decorative = false,
}: {
  className?: string;
  title?: string;
  // When the sigil sits beside text that already names the brand (the wordmark
  // lockup, the modal title), mark it decorative so it isn't announced twice.
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": title })}
    >
      <defs>
        <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--amber)" />
          <stop offset="78%" stopColor="var(--ember)" />
        </linearGradient>
      </defs>

      {/* Rising spark — struck off the face, echoing the landing embers. */}
      <path
        d="M71 14 L73.4 22.6 L82 25 L73.4 27.4 L71 36 L68.6 27.4 L60 25 L68.6 22.6 Z"
        fill="var(--amber)"
      />

      {/* Anvil: horned face (heel on the right), waist, flared base. */}
      <path
        d="M26 38
           L74 38
           L74 49
           L58 49
           L58 61
           L70 62
           L70 74
           L30 74
           L30 62
           L42 61
           L42 49
           L26 49
           L13 45.5
           Z"
        fill={`url(#${GRAD_ID})`}
        stroke="var(--ember)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Size = "sm" | "md" | "lg";

const SIGIL_SIZE: Record<Size, string> = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-11 w-11",
};

const TEXT_SIZE: Record<Size, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
};

export function ForgeLogo({
  size = "md",
  href,
  className = "",
}: {
  size?: Size;
  href?: string;
  className?: string;
}) {
  const inner = (
    <span
      className={`forge-logo group inline-flex items-center gap-2.5 ${className}`}
    >
      <ForgeSigil
        decorative
        className={`forge-logo-sigil ${SIGIL_SIZE[size]} shrink-0 transition-transform duration-300`}
      />
      <span
        className={`font-display ${TEXT_SIZE[size]} font-light leading-none tracking-tight`}
      >
        Week
        <span
          className="italic"
          style={{
            background: "linear-gradient(180deg, var(--amber), var(--ember) 70%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Forge
        </span>
      </span>
    </span>
  );

  if (href) {
    return (
      <Link href={href} aria-label="WeekForge home" className="inline-flex">
        {inner}
      </Link>
    );
  }
  return inner;
}
