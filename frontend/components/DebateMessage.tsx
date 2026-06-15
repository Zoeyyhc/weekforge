import ReactMarkdown from "react-markdown";
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
      className={`animate-rise-in rounded-lg border-l-2 p-3 ${meta.color} ${meta.ring}`}
      data-testid="debate-message"
    >
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden>{meta.emoji}</span>
        <span>{meta.label}</span>
        <span className="text-xs font-normal opacity-70">
          {EVENT_LABEL[event.event_type] ?? event.event_type}
        </span>
      </div>
      <div className="text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-bold [&_h3]:font-semibold [&_h3]:text-base [&_h3]:mb-1 [&_h4]:font-semibold [&_h4]:mb-1 [&_p]:mb-1 last:[&_p]:mb-0">
        <ReactMarkdown>{event.content}</ReactMarkdown>
      </div>
    </div>
  );
}
