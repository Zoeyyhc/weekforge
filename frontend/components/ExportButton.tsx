"use client";

import { useState } from "react";
import { ExportResult } from "@/lib/api";

export function ExportButton({
  onExport,
}: {
  onExport: () => Promise<ExportResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      setResult(await onExport());
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
        {busy ? "Adding…" : "Add to Google Calendar"}
      </button>
      {result && (
        <p className="text-sm text-emerald-300" data-testid="export-result">
          Wrote {result.written} events.{" "}
          <a href={result.calendar_url} className="underline" target="_blank" rel="noreferrer">
            Open Google Calendar
          </a>
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
