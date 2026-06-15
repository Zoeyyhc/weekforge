// Quiet sibling of the landing's ForgeBackground. The app is a working
// surface, so the atmosphere is dialed back: a low-opacity molten mesh, the
// shared film grain, and a soft top vignette — enough to tie the workspace to
// the forge world without fighting the foreground cards for contrast. Pure
// CSS/SVG, server-safe, honors prefers-reduced-motion via globals.css.
export function AppAtmosphere() {
  return (
    <div
      aria-hidden
      className="grain pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      {/* Molten light pools, slow drift, held back so cards stay readable. */}
      <div className="forge-mesh animate-mesh-drift absolute inset-0 opacity-40" />

      {/* Soft vignette: warm ember crown up top, settling into the base. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_-10%,rgba(255,107,53,0.06)_0%,transparent_45%),radial-gradient(120%_90%_at_50%_100%,rgba(8,9,12,0.6)_0%,transparent_60%)]" />
    </div>
  );
}
