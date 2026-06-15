export type SigilType = "hawk" | "guardian" | "batcher" | "arbiter";

// Per-champion glyphs. All stroke-based, viewBox 0 0 100 100, drawn with
// currentColor so the parent sets the hue. Shared visual language (centered,
// ~50px tall, round caps) keeps the four reading as one crest set while each
// inner motif carries the character.
function Glyph({ type }: { type: SigilType }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "hawk":
      // A raptor in a dive — angular feathered wings, a striking head.
      return (
        <g {...common}>
          <path d="M50 34 L50 48" />
          <path d="M45 34 L50 26 L55 34" />
          <polyline points="50,44 30,38 36,48 24,50 38,58 50,55" />
          <polyline points="50,44 70,38 64,48 76,50 62,58 50,55" />
          <path d="M47 56 L44 72" />
          <path d="M53 56 L56 72" />
        </g>
      );
    case "guardian":
      // A shield cradling a vital pulse — protection + sustainable energy.
      return (
        <g {...common}>
          <path d="M50 22 L74 31 L74 50 C74 67 63 76 50 80 C37 76 26 67 26 50 L26 31 Z" />
          <polyline
            points="32,52 42,52 46,43 50,61 54,47 58,52 68,52"
            strokeWidth={2.2}
          />
        </g>
      );
    case "batcher":
      // Converging focus brackets around a single locked target.
      return (
        <g {...common}>
          <circle cx="50" cy="50" r="3.4" fill="currentColor" stroke="none" />
          <circle cx="50" cy="50" r="13" strokeWidth={1.6} opacity={0.85} />
          <circle
            cx="50"
            cy="50"
            r="23"
            strokeWidth={1.4}
            strokeDasharray="3 6"
            opacity={0.55}
          />
          <path d="M30 38 L30 30 L38 30" />
          <path d="M62 30 L70 30 L70 38" />
          <path d="M70 62 L70 70 L62 70" />
          <path d="M38 70 L30 70 L30 62" />
        </g>
      );
    case "arbiter":
      // A balance held in equilibrium — weighing every claim in the open.
      return (
        <g {...common}>
          <path d="M50 34 L50 66" />
          <path d="M45 34 L50 28 L55 34" />
          <path d="M40 72 L60 72" />
          <path d="M28 36 L72 36" />
          <path d="M28 36 L23 47" />
          <path d="M28 36 L33 47" />
          <path d="M21 47 C25 57, 31 57, 35 47" />
          <path d="M72 36 L67 47" />
          <path d="M72 36 L77 47" />
          <path d="M65 47 C69 57, 75 57, 79 47" />
        </g>
      );
  }
}

export function ChampionSigil({
  type,
  color,
  size = "lg",
}: {
  type: SigilType;
  color: string;
  // "lg" = the landing crest (h-28); "sm" = a compact roster badge (h-11).
  size?: "lg" | "sm";
}) {
  const sm = size === "sm";
  return (
    <div
      className={`relative grid place-items-center ${sm ? "h-11 w-11" : "h-28 w-28"}`}
      style={{ ["--c" as string]: color }}
    >
      {/* Breathing aura behind the glyph. */}
      <div
        aria-hidden
        className={`champion-aura animate-aura absolute inset-0 rounded-full ${sm ? "blur-md" : "blur-xl"}`}
        style={{ background: `radial-gradient(circle, ${color}, transparent 70%)` }}
      />
      {/* Crest frame ring. */}
      <div
        className={`absolute rounded-full border ${sm ? "inset-0.5" : "inset-1"}`}
        style={{ borderColor: `${color}33` }}
      />
      <svg
        viewBox="0 0 100 100"
        className={`champion-glyph relative transition-[filter,transform] duration-500 ${sm ? "h-7 w-7" : "h-20 w-20"}`}
        style={{ color }}
      >
        <Glyph type={type} />
      </svg>
    </div>
  );
}
