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
      className="group/block relative overflow-hidden rounded-xl border border-[#272430] bg-gradient-to-b from-[#15171f] to-[#101219] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-300 focus-within:border-batcher/45 hover:border-[#34303c]"
      data-testid="busy-block-row"
    >
      {/* Cool left edge — the hours you cannot move. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-batcher/70 to-arbiter/70 opacity-40 transition-opacity duration-300 group-focus-within/block:opacity-100"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5 pl-5">
        <input
          type="text"
          data-testid="busy-label-input"
          aria-label="Commitment label"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="What holds this time?"
          className="min-w-[8rem] flex-1 border-0 border-b border-transparent bg-transparent py-1 text-sm text-foreground outline-none transition-colors placeholder:text-[#403b46] focus:border-batcher/50"
        />
        <div className="flex items-center gap-2 rounded-lg bg-[#0c0d12] px-2.5 py-1.5 ring-1 ring-[#272430]">
          <input
            data-testid="busy-start-input"
            type="datetime-local"
            value={draft.start}
            onChange={(e) => onChange({ start: e.target.value })}
            className="border-0 bg-transparent font-mono text-xs text-foreground outline-none [color-scheme:dark]"
            aria-label="Start time"
          />
          <span className="font-mono text-xs text-batcher/70" aria-hidden="true">
            →
          </span>
          <input
            data-testid="busy-end-input"
            type="datetime-local"
            value={draft.end}
            onChange={(e) => onChange({ end: e.target.value })}
            className="border-0 bg-transparent font-mono text-xs text-foreground outline-none [color-scheme:dark]"
            aria-label="End time"
          />
        </div>
        <button
          type="button"
          data-testid="busy-remove"
          onClick={onRemove}
          aria-label="Remove busy block"
          className="px-1 text-lg leading-none text-[#3a3530] transition-colors hover:text-rose-400"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
