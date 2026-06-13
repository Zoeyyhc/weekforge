import { DebateEventMsg } from "@/lib/types";
import { agentMeta } from "@/lib/agents";

const EVENT_LABEL: Record<string, string> = {
  proposal: "proposes",
  critique: "critiques",
  arbitration: "decides",
  human_intervention: "intervenes",
  validation_fail: "retrying",
  system: "system",
};

export function DebateMessage({ event }: { event: DebateEventMsg }) {
  const meta = agentMeta(event.speaker);
  return (
    <div
      className={`rounded-lg border p-3 ${meta.color} ${meta.ring}`}
      data-testid="debate-message"
    >
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden>{meta.emoji}</span>
        <span>{meta.label}</span>
        <span className="text-xs font-normal opacity-70">
          {EVENT_LABEL[event.event_type] ?? event.event_type}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{event.content}</p>
    </div>
  );
}
