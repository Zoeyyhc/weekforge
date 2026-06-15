import { Speaker } from "@/lib/types";
import type { SigilType } from "@/components/landing/ChampionSigil";

export interface AgentMeta {
  label: string;
  emoji: string;
  color: string; // bubble background + text (dark)
  ring: string;  // border/ring colour (dark)
  tagline: string;
  // The four debaters carry their landing crest + signature glow hue so the
  // council reads as the same characters across marketing and the workspace.
  // `hue` is a raw CSS colour (a forge palette var) used for sigils, glows,
  // and accents; absent for Human/System, which fall back to the emoji chip.
  sigil?: SigilType;
  hue?: string;
}

const AGENTS: Record<Speaker, AgentMeta> = {
  DeadlineHawk: {
    label: "Deadline Hawk",
    emoji: "🦅",
    color: "bg-rose-950/40 text-rose-200",
    ring: "border-rose-400/60",
    tagline: "Hit every deadline",
    sigil: "hawk",
    hue: "var(--hawk)",
  },
  EnergyGuardian: {
    label: "Energy Guardian",
    emoji: "🔋",
    color: "bg-emerald-950/40 text-emerald-200",
    ring: "border-emerald-400/60",
    tagline: "Protect against burnout",
    sigil: "guardian",
    hue: "var(--guardian)",
  },
  FocusBatcher: {
    label: "Focus Batcher",
    emoji: "🎯",
    color: "bg-cyan-950/40 text-cyan-200",
    ring: "border-cyan-400/60",
    tagline: "Minimise context-switching",
    sigil: "batcher",
    hue: "var(--batcher)",
  },
  Arbiter: {
    label: "Arbiter",
    emoji: "⚖️",
    color: "bg-violet-950/40 text-violet-200",
    ring: "border-violet-400/60",
    tagline: "Weigh the trade-offs",
    sigil: "arbiter",
    hue: "var(--arbiter)",
  },
  Human: {
    label: "You",
    emoji: "🧑",
    color: "bg-slate-800/60 text-slate-100",
    ring: "border-slate-400/60",
    tagline: "Final arbiter",
  },
  System: {
    label: "System",
    emoji: "⚙️",
    color: "bg-slate-900/60 text-slate-400",
    ring: "border-slate-700",
    tagline: "Engine",
  },
};

export function agentMeta(speaker: Speaker): AgentMeta {
  return AGENTS[speaker] ?? AGENTS.System;
}
