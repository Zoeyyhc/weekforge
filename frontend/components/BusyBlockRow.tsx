"use client";

import { BusyBlockDraft } from "@/lib/buildRequest";

export function BusyBlockRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: BusyBlockDraft;
  onChange: (patch: Partial<BusyBlockDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="busy-block-row">
      <input
        type="text"
        data-testid="busy-label-input"
        aria-label="Commitment label"
        value={draft.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Commitment"
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        data-testid="busy-start-input"
        type="datetime-local"
        value={draft.start}
        onChange={(e) => onChange({ start: e.target.value })}
        className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="Start time"
      />
      <span className="text-xs text-slate-400" aria-hidden="true">→</span>
      <input
        data-testid="busy-end-input"
        type="datetime-local"
        value={draft.end}
        onChange={(e) => onChange({ end: e.target.value })}
        className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
        aria-label="End time"
      />
      <button
        type="button"
        data-testid="busy-remove"
        onClick={onRemove}
        aria-label="Remove busy block"
        className="rounded-lg px-2 py-2 text-slate-400 hover:text-rose-600"
      >
        ✕
      </button>
    </div>
  );
}
