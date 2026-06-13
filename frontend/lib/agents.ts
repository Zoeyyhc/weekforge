import { Speaker } from "@/lib/types";

export interface AgentMeta {
  label: string;
  emoji: string;
  color: string;
  ring: string;
  tagline: string;
}

const AGENTS: Record<Speaker, AgentMeta> = {
  DeadlineHawk: {
    label: "Deadline Hawk",
    emoji: "🦅",
    color: "bg-rose-50 text-rose-900",
    ring: "border-rose-300",
    tagline: "Hit every deadline",
  },
  EnergyGuardian: {
    label: "Energy Guardian",
    emoji: "🔋",
    color: "bg-emerald-50 text-emerald-900",
    ring: "border-emerald-300",
    tagline: "Protect against burnout",
  },
  FocusBatcher: {
    label: "Focus Batcher",
    emoji: "🎯",
    color: "bg-indigo-50 text-indigo-900",
    ring: "border-indigo-300",
    tagline: "Minimise context-switching",
  },
  Arbiter: {
    label: "Arbiter",
    emoji: "⚖️",
    color: "bg-violet-50 text-violet-900",
    ring: "border-violet-300",
    tagline: "Weigh the trade-offs",
  },
  Human: {
    label: "You",
    emoji: "🧑",
    color: "bg-slate-100 text-slate-900",
    ring: "border-slate-300",
    tagline: "Final arbiter",
  },
  System: {
    label: "System",
    emoji: "⚙️",
    color: "bg-slate-50 text-slate-600",
    ring: "border-slate-200",
    tagline: "Engine",
  },
};

export function agentMeta(speaker: Speaker): AgentMeta {
  return AGENTS[speaker] ?? AGENTS.System;
}
