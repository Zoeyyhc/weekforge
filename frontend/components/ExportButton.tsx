"use client";

import { useState } from "react";

export function ExportButton({ onExport }: { onExport: () => Promise<Blob> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const blob = await onExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "weekforge.ics";
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="self-start rounded-lg bg-gradient-to-br from-ember to-amber px-4 py-2 text-sm font-semibold text-[#1a1208] disabled:opacity-50"
      >
        {busy ? "Building…" : "Download .ics"}
      </button>
      <p className="text-xs leading-relaxed text-muted" data-testid="export-safety-note">
        WeekForge builds a calendar file — your existing calendar is never touched. Import it
        into Google, Apple, or Outlook.
      </p>
      {done && (
        <p className="text-sm text-emerald-300" data-testid="export-result">
          Calendar file downloaded. Open it to import this week into your calendar app.
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-300" data-testid="export-error">
          {error}
        </p>
      )}
    </div>
  );
}
