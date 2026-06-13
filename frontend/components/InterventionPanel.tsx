"use client";

import { useState } from "react";
import { InterruptMsg } from "@/lib/types";

const QUICK_ACTIONS = [
  {
    label: "Side with Deadline Hawk",
    text: "I side with the Deadline Hawk — prioritise hitting deadlines, even if the days are packed.",
  },
  {
    label: "Side with Energy Guardian",
    text: "I side with the Energy Guardian — protect breaks and avoid back-to-back intense work.",
  },
  {
    label: "Side with Focus Batcher",
    text: "I side with the Focus Batcher — group similar tasks and protect long focus blocks.",
  },
];

export function InterventionPanel({
  interrupt,
  onSubmit,
  disabled,
}: {
  interrupt: InterruptMsg;
  onSubmit: (input: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  return (
    <div
      className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4"
      data-testid="intervention-panel"
    >
      <h3 className="font-semibold text-amber-900">The council needs you</h3>
      <p className="mt-1 text-sm text-amber-800">{interrupt.interrupt_reason}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => setText(a.text)}
            className="rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            {a.label}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a constraint, side with an agent, or veto…"
        rows={3}
        className="mt-3 w-full rounded-lg border border-amber-300 p-2 text-sm"
      />

      <button
        type="button"
        disabled={disabled || text.trim() === ""}
        onClick={() => onSubmit(text.trim())}
        className="mt-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
      >
        Submit &amp; resume debate
      </button>
    </div>
  );
}
