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
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:border-amber"
        data-testid="google-connect"
      >
        <span aria-hidden>📅</span> Connect Google Calendar
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm" data-testid="google-connected">
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> Google Calendar connected
      </span>
      <a href={disconnectUrl} className="text-muted underline hover:text-foreground">
        Disconnect
      </a>
    </div>
  );
}
