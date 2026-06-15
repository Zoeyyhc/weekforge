// Full-bleed atmospheric backdrop for the landing: a slowly drifting molten
// gradient mesh, a film-grain overlay, and a field of rising ember particles.
// Pure CSS/SVG — safe to render on the server. Honors prefers-reduced-motion
// via the animation classes defined in globals.css.

const EMBERS = [
  { left: "8%", delay: "0s", dur: "7s", size: 3 },
  { left: "21%", delay: "2.4s", dur: "9s", size: 2 },
  { left: "34%", delay: "4.1s", dur: "6.5s", size: 4 },
  { left: "47%", delay: "1.2s", dur: "8s", size: 2 },
  { left: "59%", delay: "3.6s", dur: "7.5s", size: 3 },
  { left: "68%", delay: "5.2s", dur: "9.5s", size: 2 },
  { left: "77%", delay: "0.6s", dur: "6.8s", size: 4 },
  { left: "86%", delay: "2.9s", dur: "8.4s", size: 3 },
  { left: "93%", delay: "4.7s", dur: "7.2s", size: 2 },
];

export function ForgeBackground() {
  return (
    <div
      aria-hidden
      className="grain pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      {/* Molten light pools, slowly drifting. */}
      <div className="forge-mesh animate-mesh-drift absolute inset-0" />

      {/* Deep vignette to focus the center and seat the embers. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_40%,rgba(8,9,12,0.7)_100%)]" />

      {/* Rising embers. */}
      {EMBERS.map((e, i) => (
        <span
          key={i}
          className="absolute bottom-[-12px] rounded-full"
          style={{
            left: e.left,
            width: e.size,
            height: e.size,
            background:
              "radial-gradient(circle, var(--amber), var(--ember) 60%, transparent)",
            boxShadow: "0 0 8px 1px rgba(255,107,53,0.6)",
            animation: `ember-rise ${e.dur} linear ${e.delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}
