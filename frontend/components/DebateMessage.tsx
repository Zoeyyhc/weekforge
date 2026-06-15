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
  const hue = meta.hue;
  return (
    <div
      className={`animate-rise-in relative overflow-hidden rounded-xl border-l-2 p-3.5 pl-4 ${meta.color} ${meta.ring}`}
      data-testid="debate-message"
      style={hue ? { boxShadow: `inset 2px 0 12px -8px ${hue}` } : undefined}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span aria-hidden className="text-[0.95rem] leading-none">{meta.emoji}</span>
        <span className="font-display text-[0.95rem] leading-none">{meta.label}</span>
        <span
          className="font-mono text-[0.62rem] uppercase tracking-[0.16em] opacity-70"
          style={hue ? { color: hue } : undefined}
        >
          {EVENT_LABEL[event.event_type] ?? event.event_type}
        </span>
      </div>
      <div className="font-sans text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-bold [&_h3]:font-semibold [&_h3]:text-base [&_h3]:mb-1 [&_h4]:font-semibold [&_h4]:mb-1 [&_p]:mb-1 last:[&_p]:mb-0">
        <ReactMarkdown>{event.content}</ReactMarkdown>
      </div>
    </div>
  );
}
