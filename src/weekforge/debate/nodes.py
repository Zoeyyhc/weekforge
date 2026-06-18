"""LangGraph node functions for the WeekForge debate engine."""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from anthropic import Anthropic

from weekforge.debate.debaters import Council
from weekforge.debate.validation import (
    ValidationReport,
    _localize,
    classify_blocks,
    remaining_focus_budget,
    underscheduled_tasks,
    validate_blocks,
)
from weekforge.debate.state import DEBATER_NAMES, DebateEvent, DebateState
from weekforge.models import Preferences, Schedule, Task, TimeBlock


logger = logging.getLogger(__name__)


# ── Formatting helpers ──────────────────────────────────────────────────────

def _fmt_tasks(state: DebateState) -> str:
    lines = []
    for t in state["tasks"]:
        line = f"- [{t.id}] {t.title} ({t.estimated_minutes}min, priority {t.priority}"
        if t.deadline:
            line += f", deadline {t.deadline.strftime('%a %d %b')}"
        if t.category:
            line += f", category: {t.category}"
        if t.preferred_days:
            pref = " · ".join(
                f"{'1st' if i == 0 else '2nd'} {d}"
                for i, d in enumerate(t.preferred_days[:2])
            )
            line += f", prefer: {pref}"
        if t.remark:
            safe = t.remark.replace("\\", "\\\\").replace('"', '\\"')
            line += f', note: "{safe}"'
        line += ")"
        lines.append(line)
    return "\n".join(lines) if lines else "No tasks."


def _fmt_busy(state: DebateState) -> str:
    tz_name = state["preferences"].timezone
    tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    lines = [
        f"- {b.label}: "
        f"{b.start.astimezone(tz).strftime('%a %d %b %H:%M')}–"
        f"{b.end.astimezone(tz).strftime('%H:%M')} local"
        for b in state["busy_blocks"]
    ]
    return "\n".join(lines) if lines else "No fixed commitments."


def _fmt_prefs(state: DebateState) -> str:
    p = state["preferences"]
    tz_clause = f" ({p.timezone})" if p.timezone else " (timezone unknown — assume UTC)"
    return (
        f"Work hours {p.workday_start_hour}:00–{p.workday_end_hour}:00 LOCAL TIME{tz_clause}, "
        f"max focus {p.max_focus_minutes_per_day}min/day, "
        f"max single focus block {p.max_focus_minutes_per_block}min. "
        f"All scheduled blocks MUST fall within this local time window. "
        f"Output datetimes as LOCAL wall-clock time in {p.timezone or 'UTC'} "
        f"(e.g. 2026-06-16T09:00:00) with NO timezone offset and NO trailing 'Z'."
    )


def _fmt_window(state: DebateState) -> str:
    ws = state.get("window_start")
    we = state.get("window_end")
    if not ws or not we:
        return state.get("week_start") or "this week"
    tz = ZoneInfo(state["preferences"].timezone) if state["preferences"].timezone else timezone.utc
    return (
        f"{ws.astimezone(tz).strftime('%a %d %b %H:%M')} "
        f"to {we.astimezone(tz).strftime('%a %d %b %H:%M')} local"
    )


def _fmt_transcript_tail(state: DebateState, n: int = 12) -> str:
    return "\n".join(
        f"[Round {e['round']} {e['speaker']}] {e['content']}"
        for e in state["transcript"][-n:]
    )


def _scoped_repair_feedback(report: ValidationReport, preferences: Preferences) -> str:
    """Human-readable FROZEN/BROKEN + per-day budget message for a failed validation."""
    tz = ZoneInfo(preferences.timezone) if preferences.timezone else timezone.utc
    lines = [
        "Schedule failed semantic validation. "
        "Keep the FROZEN blocks exactly as-is; only re-place the BROKEN ones.",
        "",
    ]
    frozen = report.frozen
    if frozen:
        lines.append("FROZEN (do not move, already valid):")
        for b in frozen:
            ls = b.start.astimezone(tz)
            le = b.end.astimezone(tz)
            lines.append(f"  - {b.label}: {ls.strftime('%a %H:%M')}–{le.strftime('%H:%M')} local")
    if report.to_fix:
        lines.append("BROKEN (re-place these only):")
        for rep in report.to_fix:
            reasons = rep.errors + rep.day_reasons
            lines.append(f"  - {rep.block.label}: {'; '.join(reasons)}")
    budget = remaining_focus_budget(frozen, preferences)
    if budget:
        lines.append("Daily focus budget remaining after FROZEN blocks:")
        for day in sorted(budget):
            lines.append(
                f"  - {day.strftime('%a %d %b')}: {budget[day]}min left "
                f"(cap {preferences.max_focus_minutes_per_day})"
            )
    return "\n".join(lines)


# ── Node factories ──────────────────────────────────────────────────────────

def make_gather_proposals_node(council: Council):
    """Return a LangGraph node that asks each debater to propose a schedule."""

    def gather_proposals(state: DebateState) -> dict:
        new_round = state["round_number"] + 1
        context = (
            f"Schedulable window: {_fmt_window(state)}. "
            f"Every block MUST start at/after the window start and end at/before the window end. "
            f"Do NOT schedule anything before the window start (those days/hours are in the past).\n"
            f"All datetimes MUST be LOCAL wall-clock in {state['preferences'].timezone or 'UTC'} "
            f"with NO offset and NO 'Z' (e.g. 2026-06-16T09:00:00).\n\n"
            f"Tasks to schedule:\n{_fmt_tasks(state)}\n\n"
            f"Fixed commitments this week:\n{_fmt_busy(state)}\n\n"
            f"User preferences: {_fmt_prefs(state)}\n\n"
            f"Debate so far:\n{_fmt_transcript_tail(state)}"
        )
        proposals: dict[str, str] = {}
        events: list[DebateEvent] = []
        for name in DEBATER_NAMES:
            text = council.propose(name, context)
            proposals[name] = text
            events.append({"round": new_round, "speaker": name, "content": text, "event_type": "proposal"})
        return {"proposals": proposals, "round_number": new_round, "transcript": events}

    return gather_proposals


def make_critique_node(council: Council):
    """Return a LangGraph node that asks each debater to critique the current proposals."""

    def critique(state: DebateState) -> dict:
        proposals_text = "\n\n".join(
            f"**{name}**: {text}" for name, text in state["proposals"].items()
        )
        context = (
            f"Tasks: {_fmt_tasks(state)}\n\n"
            f"Current proposals from all council members:\n{proposals_text}"
        )
        critiques: dict[str, str] = {}
        events: list[DebateEvent] = []
        for name in DEBATER_NAMES:
            text = council.critique(name, context)
            critiques[name] = text
            events.append({"round": state["round_number"], "speaker": name, "content": text, "event_type": "critique"})
        return {"critiques": critiques, "transcript": events}

    return critique


def make_check_convergence_node(api_key: str, require_human_on_stall: bool = True):
    """Return a LangGraph node that asks Claude Haiku if the proposals have converged.

    Args:
        require_human_on_stall: When True (default), a stalled council (no consensus
            after max_rounds) sets interrupt_reason, which routes to human_interrupt.
            When False, interrupt_reason is left unset and the router sends the stalled
            debate straight to the Arbiter, so the run completes unattended.
    """
    client = Anthropic(api_key=api_key)

    def check_convergence(state: DebateState) -> dict:
        proposals_text = "\n\n".join(f"{k}: {v}" for k, v in state["proposals"].items())
        critiques_text = "\n\n".join(f"{k}: {v}" for k, v in state["critiques"].items())

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            messages=[{
                "role": "user",
                "content": (
                    f"Proposals:\n{proposals_text}\n\nCritiques:\n{critiques_text}\n\n"
                    "Are the proposals substantially aligned (only minor disagreements remain)? "
                    "Answer only: yes or no"
                ),
            }],
        )
        answer = response.content[0].text.strip().lower()
        converged = answer.startswith("yes")

        interrupt_reason: str | None = None
        stalled = not converged and state["round_number"] >= state["max_rounds"]
        if stalled and require_human_on_stall:
            interrupt_reason = (
                f"The council could not reach consensus after {state['max_rounds']} rounds. "
                "Please review the proposals and provide guidance."
            )

        return {"converged": converged, "interrupt_reason": interrupt_reason}

    return check_convergence


def _first_sentence(text: str) -> str:
    """The opening sentence of a proposal — the Herald's degraded fallback line.

    Mirrors the frontend's `splitProposal` lead so a model failure reads the same
    as the presentational default.
    """
    trimmed = text.strip()
    match = re.match(r"^.*?[.!?](\s|$)", trimmed)
    if match and len(match.group(0).strip()) < len(trimmed):
        return match.group(0).strip()
    return trimmed


def make_herald_node(api_key: str):
    """Return a node where the Herald distils each champion's proposal to one line.

    The Herald is a *neutral summariser*: it never ranks, recommends, or invents
    consensus (that would anchor the human's vote and collide with the Arbiter).
    It runs only on the stall/interrupt path, so a converged debate never pays for
    it. Output is best-effort — a missing or malformed model reply degrades to each
    proposal's opening sentence so the vote is never blocked.
    """
    client = Anthropic(api_key=api_key)

    def herald(state: DebateState) -> dict:
        proposals = state.get("proposals") or {}
        if not proposals:
            return {"proposal_summaries": {}}

        fallback = {name: _first_sentence(text) for name, text in proposals.items()}
        proposals_text = "\n\n".join(f"{name}: {text}" for name, text in proposals.items())
        prompt = (
            "You are the Herald: a neutral summariser for a council of scheduling "
            "champions. Distil each champion's proposal below into exactly one sentence "
            "(a short declarative line, ~12 words max) that captures their stance.\n"
            "RULES: Do NOT recommend, rank, judge, or pick a winner. Do NOT invent "
            "agreement between champions. Give every champion equal weight. Summarise "
            "only what their proposal actually says.\n\n"
            f"Champions:\n{proposals_text}\n\n"
            'Output ONLY a raw JSON object of the form {"summaries": {"<ChampionName>": '
            '"<one sentence>", ...}} with exactly these keys: '
            f"{list(proposals.keys())}. No markdown."
        )
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            if raw.startswith("```"):
                raw = "\n".join(raw.split("\n")[1:-1])
            model_summaries = json.loads(raw)["summaries"]
            summaries = {}
            for name in proposals:
                line = model_summaries.get(name) if isinstance(model_summaries, dict) else None
                summaries[name] = (
                    line.strip() if isinstance(line, str) and line.strip() else fallback[name]
                )
        except Exception as exc:
            logger.warning("Herald summary failed (%s); using first-sentence fallback.", exc)
            summaries = fallback

        return {"proposal_summaries": summaries}

    return herald


def human_interrupt_node(state: DebateState) -> dict:
    """Pause the graph and wait for human input via LangGraph's interrupt mechanism."""
    from langgraph.types import interrupt

    value = interrupt({
        "type": "needs_human_input",
        "interrupt_reason": state["interrupt_reason"],
        "proposals": state["proposals"],
        "proposal_summaries": state.get("proposal_summaries", {}),
        "round": state["round_number"],
    })
    event = {
        "round": state["round_number"],
        "speaker": "Human",
        "content": str(value),
        "event_type": "human_intervention",
    }
    return {"human_input": str(value), "transcript": [event]}


def make_arbitrate_node(council: Council):
    """Return a LangGraph node that asks the Arbiter to synthesise a final schedule."""

    def arbitrate(state: DebateState) -> dict:
        proposals_text = "\n\n".join(f"**{k}**: {v}" for k, v in state["proposals"].items())
        critiques_text = "\n\n".join(f"**{k}**: {v}" for k, v in state["critiques"].items())
        human_note = (
            f"\n\nHuman arbiter input: {state['human_input']}"
            if state.get("human_input")
            else ""
        )
        prev_error = (
            f"\n\nPrevious attempt failed validation: {state['validation_error']}. "
            "Please output valid JSON only."
            if state.get("validation_error")
            else ""
        )
        frozen = state.get("frozen_blocks") or []
        scoped = ""
        if frozen and state.get("validation_error"):
            tz = ZoneInfo(state["preferences"].timezone) if state["preferences"].timezone else timezone.utc
            occupied = "\n".join(
                f"- {b.label}: {b.start.astimezone(tz).strftime('%a %H:%M')}–"
                f"{b.end.astimezone(tz).strftime('%H:%M')} local"
                for b in frozen
            )
            budget = remaining_focus_budget(frozen, state["preferences"])
            budget_lines = "\n".join(
                f"- {day.strftime('%a %d %b')}: {mins}min left"
                for day, mins in sorted(budget.items())
            )
            scoped = (
                "\n\nSCOPED REPAIR — the previous schedule was mostly valid. "
                "The blocks below are ALREADY FINAL. Do NOT move, resize, or drop them; "
                "place nothing that overlaps them:\n"
                f"{occupied}\n"
                "Remaining daily focus budget AFTER these fixed blocks (do not exceed):\n"
                f"{budget_lines}\n"
                "Output JSON for ONLY the tasks flagged as broken in the validation feedback above. "
                "Do NOT output the fixed blocks listed here — the system re-attaches them automatically. "
                "Do not place anything that overlaps them, and stay within the remaining daily budget."
            )
        context = (
            f"Schedulable window: {_fmt_window(state)}. "
            f"Every block MUST start at/after the window start and end at/before the window end. "
            f"Do NOT schedule anything before the window start (those days/hours are in the past).\n"
            f"All datetimes MUST be LOCAL wall-clock in {state['preferences'].timezone or 'UTC'} "
            f"with NO offset and NO 'Z' (e.g. 2026-06-16T09:00:00).\n\n"
            f"Tasks:\n{_fmt_tasks(state)}\n\n"
            f"Fixed commitments this week:\n{_fmt_busy(state)}\n\n"
            f"User preferences: {_fmt_prefs(state)}\n\n"
            f"HARD SCHEDULING CONSTRAINTS (violating any of these forces a retry):\n"
            f"- Every block's START local hour must be at or after the workday start hour above.\n"
            f"- Every block's END local hour must be at or before the workday end hour above.\n"
            f"- No block may cross midnight: a block's start and end MUST fall on the same local date.\n"
            f"- When the workday window reaches midnight, end blocks at 23:59 local — never 00:00 of the next day.\n"
            f"- No single block may exceed {state['preferences'].max_focus_minutes_per_block} minutes. "
            f"Split a longer task into multiple blocks sharing the same task_id, each with a "
            f"distinct label (e.g. 'Report (1/2)', 'Report (2/2)').\n\n"
            f"Proposals:\n{proposals_text}\n\n"
            f"Critiques:\n{critiques_text}"
            f"{human_note}{prev_error}{scoped}"
        )
        text = council.arbitrate(context)
        event = {
            "round": state["round_number"],
            "speaker": "Arbiter",
            "content": text,
            "event_type": "arbitration",
        }
        return {"arbiter_output": text, "validation_error": None, "transcript": [event]}

    return arbitrate


def make_validate_node(api_key: str):
    """Return a node that parses the Arbiter's JSON output into a Schedule."""
    client = Anthropic(api_key=api_key)

    def validate(state: DebateState) -> dict:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": (
                    f"Task IDs available: {[t.id for t in state['tasks']]}\n"
                    f"Week: {state.get('week_start') or 'not specified'} (all datetimes must be in this week as local wall-clock, no offset)\n"
                    f"Arbiter output:\n{state.get('arbiter_output', '')}\n\n"
                    "Extract a JSON array of time blocks. Each object must have: "
                    "start (local wall-clock ISO 8601, e.g. 2026-06-16T09:00:00, NO timezone/offset), "
                    "end (local wall-clock ISO 8601, NO timezone/offset), "
                    "label (string), task_id (task id string or null). "
                    "Output ONLY the raw JSON array, no markdown."
                ),
            }],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:-1])
        try:
            blocks_data = json.loads(raw)
            blocks = [
                TimeBlock(
                    start=_localize(b["start"], state["preferences"]),
                    end=_localize(b["end"], state["preferences"]),
                    label=b["label"],
                    task_id=b.get("task_id"),
                )
                for b in blocks_data
            ]
            frozen_in = state.get("frozen_blocks") or []
            if frozen_in:
                frozen_labels = {b.label for b in frozen_in}
                # Frozen blocks are authoritative: drop any model re-emission of them.
                blocks = frozen_in + [b for b in blocks if b.label not in frozen_labels]
            report = classify_blocks(
                blocks,
                state["tasks"],
                state["busy_blocks"],
                state["preferences"],
                window=(
                    (state["window_start"], state["window_end"])
                    if state.get("window_start") is not None and state.get("window_end") is not None
                    else None
                ),
            )
            if not report.ok:
                error_msg = _scoped_repair_feedback(report, state["preferences"])
                event = {
                    "round": state["round_number"],
                    "speaker": "System",
                    "content": f"{error_msg}\nRetrying arbitration.",
                    "event_type": "validation_fail",
                }
                return {
                    "schedule": None,
                    "validation_error": error_msg,
                    "validation_warnings": error_msg,
                    # Blocks parsed fine — keep them as the best-effort fallback.
                    "best_effort_schedule": Schedule(blocks=blocks),
                    "frozen_blocks": report.frozen,
                    "validation_attempts": state.get("validation_attempts", 0) + 1,
                    "transcript": [event],
                }
            short = underscheduled_tasks(blocks, state["tasks"])
            warning = None
            if short:
                titles = {t.id: t.title for t in state["tasks"]}
                warning = "Under-scheduled tasks (the council could not fit all estimated time): " + "; ".join(
                    f"{titles.get(tid, tid)}: only {got} of {est}min scheduled"
                    for tid, (got, est) in sorted(short.items())
                )
            return {
                "schedule": Schedule(blocks=blocks),
                "validation_error": None,
                "degraded": False,
                "validation_warnings": warning,
                "best_effort_schedule": None,
                "frozen_blocks": [],
            }
        except Exception as exc:
            error_msg = str(exc)
            event = {
                "round": state["round_number"],
                "speaker": "System",
                "content": f"Schedule parsing failed: {error_msg}. Retrying arbitration.",
                "event_type": "validation_fail",
            }
            return {
                "schedule": None,
                "validation_error": error_msg,
                "validation_attempts": state.get("validation_attempts", 0) + 1,
                "transcript": [event],
            }

    return validate


def finalize_node(state: DebateState) -> dict:
    """Terminal node.

    Normally passes the validated schedule through. If validation never produced
    a clean schedule but an earlier attempt parsed into blocks, deliver that
    best-effort schedule flagged as degraded so the UI can mark it for review.
    """
    logger.info(
        "debate finalize: validation_attempts=%d degraded=%s",
        state.get("validation_attempts", 0),
        state.get("schedule") is None and state.get("best_effort_schedule") is not None,
    )
    schedule = state.get("schedule")
    if schedule is None:
        best = state.get("best_effort_schedule")
        if best is not None:
            warning = (
                f"Exceeded {state.get('max_validation_attempts', 3)} validation "
                "retries; returning best-effort schedule (may contain semantic issues)."
            )
            event = {
                "round": state["round_number"],
                "speaker": "System",
                "content": warning,
                "event_type": "system",
            }
            return {
                "schedule": best,
                "degraded": True,
                "validation_warnings": (
                    state.get("validation_warnings") or state.get("validation_error") or warning
                ),
                "transcript": [event],
            }
    return {
        "schedule": schedule,
        "degraded": False,
        "validation_warnings": None,
        "best_effort_schedule": None,
    }
