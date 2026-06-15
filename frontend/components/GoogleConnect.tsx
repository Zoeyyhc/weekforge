export function GoogleConnect({
  connected,
  loginUrl,
  disconnectUrl,
}: {
  connected: boolean;
  loginUrl: string;
  disconnectUrl: string;
}) {
  if (!connected) {
    return (
      <a
        href={loginUrl}
        className="group inline-flex items-center gap-2.5 rounded-xl border border-[#272430] bg-[#0c0d12] px-4 py-2.5 text-sm font-semibold text-foreground/90 transition-colors hover:border-guardian/50 hover:text-foreground"
        data-testid="google-connect"
      >
        <span aria-hidden className="text-base">🗓</span>
        Bind your Google Calendar
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#4a4845] transition-colors group-hover:text-guardian/70">
          optional
        </span>
      </a>
    );
  }
  return (
    <div
      className="inline-flex items-center gap-3 rounded-xl border border-guardian/30 bg-guardian/[0.07] px-3.5 py-2 shadow-[inset_0_0_18px_-8px_var(--guardian)]"
      data-testid="google-connected"
    >
      {/* Glowing bound-rune. */}
      <span aria-hidden className="relative grid h-5 w-5 place-items-center">
        <span className="absolute inset-0 rounded-full bg-guardian/25 blur-[5px]" />
        <span className="relative h-2 w-2 rounded-full bg-guardian shadow-[0_0_10px_2px_var(--guardian)]" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">Calendar bound</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-guardian/70">
          Google · live
        </span>
      </span>
      <span aria-hidden className="mx-0.5 h-6 w-px bg-guardian/20" />
      <a
        href={disconnectUrl}
        className="font-mono text-[11px] tracking-wide text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        unbind
      </a>
    </div>
  );
}
