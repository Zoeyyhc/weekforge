"use client";

import { useEffect, useRef, useState } from "react";
import { InterruptMsg } from "@/lib/types";
import { HeraldSigil } from "@/components/HeraldSigil";

// The Herald's modal — it takes the stage the moment the council stalls and
// hands the ruling to you. Rather than make you scroll the whole debate, the
// Herald proclaims each champion's stance side by side (led by its first line,
// full proposal on demand) and offers the ruling controls right here.
//
// The Herald only *summarises*; the vote is yours. Dismiss ("read the full
// debate") falls back to the inline InterventionPanel for power users.
//
// Accessible: role=dialog, Esc + backdrop dismiss, focus moved in on open and
// restored on close, Tab trapped within.

// Champion identity: display name, signature hue (the CSS vars champions own
// elsewhere), and the sided ruling text — kept identical to InterventionPanel
// so siding reads the same wherever you do it.
const CHAMPIONS: Record<
  string,
  { name: string; hue: string; siding: string }
> = {
  DeadlineHawk: {
    name: "Deadline Hawk",
    hue: "var(--hawk)",
    siding:
      "I side with the Deadline Hawk — prioritise hitting deadlines, even if the days are packed.",
  },
  EnergyGuardian: {
    name: "Energy Guardian",
    hue: "var(--guardian)",
    siding:
      "I side with the Energy Guardian — protect breaks and avoid back-to-back intense work.",
  },
  FocusBatcher: {
    name: "Focus Batcher",
    hue: "var(--batcher)",
    siding:
      "I side with the Focus Batcher — group similar tasks and protect long focus blocks.",
  },
};

function championFor(speaker: string) {
  return (
    CHAMPIONS[speaker] ?? {
      name: speaker,
      hue: "var(--amber)",
      siding: `I side with ${speaker}.`,
    }
  );
}

// The Herald distils a proposal to its opening line; the remainder stays folded
// away until the planner asks for it.
function splitProposal(text: string): { lead: string; rest: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^.*?[.!?](\s|$)/);
  if (match && match[0].trim().length < trimmed.length) {
    return { lead: match[0].trim(), rest: trimmed.slice(match[0].length).trim() };
  }
  return { lead: trimmed, rest: "" };
}

function Stance({
  speaker,
  proposal,
  summary,
}: {
  speaker: string;
  proposal: string;
  summary?: string;
}) {
  const champion = championFor(speaker);
  const { lead: firstLine, rest } = splitProposal(proposal);
  const [open, setOpen] = useState(false);

  // The Herald's distilled line leads when it summarised; otherwise we fall back
  // to the proposal's opening sentence. Either way the full proposal sits behind
  // the fold — the Herald summarises, it never hides the source.
  const distilled = summary?.trim();
  const lead = distilled || firstLine;
  const hasMore = distilled ? proposal.trim().length > 0 : rest.length > 0;

  return (
    <li
      className="rounded-xl border border-border bg-background/50 p-3.5 text-left"
      style={{ borderLeftColor: champion.hue, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: champion.hue, boxShadow: `0 0 8px ${champion.hue}` }}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/90">
          {champion.name}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{lead}</p>
      {hasMore && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber/80 transition-colors hover:text-amber"
          >
            {open ? "Hide full proposal" : "Show full proposal"}
            <span
              aria-hidden
              className={`text-[9px] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </button>
          {open && (
            <p className="mt-2 text-sm leading-relaxed text-muted/90">{proposal.trim()}</p>
          )}
        </>
      )}
    </li>
  );
}

export function HeraldModal({
  open,
  interrupt,
  onSubmit,
  onDismiss,
  disabled = false,
}: {
  open: boolean;
  interrupt: InterruptMsg | null;
  onSubmit: (input: string) => void;
  onDismiss: () => void;
  disabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  // Focus management + key handling while open.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onDismiss]);

  if (!open || !interrupt) return null;

  const proposals = Object.entries(interrupt.proposals);
  const canRule = !disabled && text.trim() !== "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="herald-title"
      data-testid="herald-modal"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="animate-forged-backdrop absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="animate-forged-pop scroll-forge relative max-h-[88vh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-ember/40 bg-surface p-7 text-center shadow-[0_0_60px_-12px_rgba(255,107,53,0.55)]"
      >
        <div className="forge-mesh animate-mesh-drift pointer-events-none absolute inset-0 opacity-50" aria-hidden />

        <div className="relative">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center">
            <HeraldSigil decorative className="herald-sigil animate-herald-sound h-14 w-14" />
          </div>

          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-amber/80">
            The Herald
          </p>
          <h2
            id="herald-title"
            className="mt-1.5 font-display text-[clamp(1.6rem,5vw,2.1rem)] font-light italic leading-tight"
            style={{
              background: "linear-gradient(180deg, var(--amber), var(--ember) 78%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            The council is divided.
          </h2>
          <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-muted">
            {interrupt.interrupt_reason} The Herald lays out where each champion
            stands — yours is the ruling.
          </p>

          {proposals.length > 0 && (
            <ul className="mt-5 flex flex-col gap-2.5">
              {proposals.map(([speaker, proposal]) => (
                <Stance
                  key={speaker}
                  speaker={speaker}
                  proposal={proposal}
                  summary={interrupt.proposal_summaries?.[speaker]}
                />
              ))}
            </ul>
          )}

          {/* Ruling controls */}
          <div className="mt-6 text-left">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber/70">
              Cast your ruling
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {proposals.map(([speaker]) => {
                const champion = championFor(speaker);
                return (
                  <button
                    key={speaker}
                    type="button"
                    onClick={() => setText(champion.siding)}
                    className="rounded-full border bg-background/40 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/5"
                    style={{ borderColor: champion.hue, color: champion.hue }}
                  >
                    Side with the {champion.name}
                  </button>
                );
              })}
            </div>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a constraint, side with a champion, or veto…"
              rows={3}
              className="mt-3 w-full rounded-lg border border-border bg-background/50 p-2.5 text-sm text-foreground placeholder:text-muted/70 focus:border-amber/60 focus:outline-none"
            />

            <button
              type="button"
              disabled={!canRule}
              onClick={() => onSubmit(text.trim())}
              className="group mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-ember to-amber px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-[#1a0e00] shadow-[0_4px_24px_rgba(255,107,53,0.4)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_6px_40px_rgba(255,107,53,0.6)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0"
            >
              Cast your ruling &amp; resume
              <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
            </button>

            <button
              type="button"
              onClick={onDismiss}
              className="mt-3 w-full text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Read the full debate instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
