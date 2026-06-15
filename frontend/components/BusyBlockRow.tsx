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
    <div
      className="flex items-center gap-2 rounded-lg border border-[#2a2620] bg-[#111318] px-3 py-2"
      data-testid="busy-block-row"
    >
      <input
        type="text"
        data-testid="busy-label-input"
        aria-label="Commitment label"
        value={draft.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Commitment"
        className="flex-1 bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm text-foreground placeholder:text-[#3a3530] py-1 transition-colors"
      />
      <input
        data-testid="busy-start-input"
        type="datetime-local"
        value={draft.start}
        onChange={(e) => onChange({ start: e.target.value })}
        className="bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm font-mono text-foreground py-1 transition-colors"
        aria-label="Start time"
      />
      <span className="text-xs text-[#4a4845] font-mono" aria-hidden="true">→</span>
      <input
        data-testid="busy-end-input"
        type="datetime-local"
        value={draft.end}
        onChange={(e) => onChange({ end: e.target.value })}
        className="bg-transparent border-0 border-b border-[#2a2620] focus:border-ember outline-none text-sm font-mono text-foreground py-1 transition-colors"
        aria-label="End time"
      />
      <button
        type="button"
        data-testid="busy-remove"
        onClick={onRemove}
        aria-label="Remove busy block"
        className="text-[#3a3530] hover:text-rose-400 px-1 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
