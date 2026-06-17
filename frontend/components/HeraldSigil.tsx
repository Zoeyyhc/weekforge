// ─────────────────────────────────────────────────────────────
// The Herald — the council's proclaimer.
//
// Not a debating champion and not the deciding Arbiter: the Herald is
// the voice that sounds the council's state to you right before you rule.
// Its sigil is a bespoke clarion horn drawn in the same family as the anvil
// mark and the champion crests (viewBox 0 0 100 100, round joins) and filled
// with the brand's ember→amber gradient — molten metal, the voice of the
// forge itself. The signature "rising spark" doubles as the horn's sound,
// proclaimed from the bell mouth. Pair with the `herald-sigil` glow class
// for the resting ember halo every sigil carries.
// ─────────────────────────────────────────────────────────────

// Stable gradient id; duplicated across instances is fine (SVG resolves to
// the first definition and every instance paints the same hue).
const GRAD_ID = "herald-horn-grad";

export function HeraldSigil({
  className,
  title = "The Herald",
  decorative = false,
}: {
  className?: string;
  title?: string;
  // When the sigil sits beside text that already names the Herald (the modal
  // title), mark it decorative so it isn't announced twice.
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
          <stop offset="80%" stopColor="var(--ember)" />
        </linearGradient>
      </defs>

      {/* The proclamation — rising sparks sounded from the bell. */}
      <path
        d="M89 6 L91.5 14.8 L100 17.5 L91.5 20.2 L89 29 L86.5 20.2 L78 17.5 L86.5 14.8 Z"
        fill="var(--amber)"
      />
      <path
        d="M74 9 L75.3 12.7 L79 14 L75.3 15.3 L74 19 L72.7 15.3 L69 14 L72.7 12.7 Z"
        fill="var(--amber)"
        opacity={0.7}
      />

      {/* Clarion body: mouthpiece lower-left, smooth crescent flaring to an
          open bell at the upper-right. Terminates exactly at the bell rim. */}
      <path
        d="M21 75
           C 30 53, 44 34, 63 18
           C 74 11, 90 19, 85 40
           C 60 38, 43 51, 30 69
           C 27 72, 24 76, 21 75 Z"
        fill={`url(#${GRAD_ID})`}
        stroke="var(--ember)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />

      {/* Open bell mouth — the cup the verdict is sounded through. The fill
          matches the surface so it reads as a hollow on the modal panel. */}
      <ellipse
        cx="74.5"
        cy="29.5"
        rx="6"
        ry="13.5"
        transform="rotate(46 74.5 29.5)"
        fill="var(--surface)"
        stroke="var(--amber)"
        strokeWidth={2}
      />

      {/* Mouthpiece. */}
      <circle
        cx="21"
        cy="75.5"
        r="3.6"
        fill="var(--amber)"
        stroke="var(--ember)"
        strokeWidth={1.2}
      />
    </svg>
  );
}
