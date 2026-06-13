"""LangGraph node functions for the WeekForge debate engine."""

from __future__ import annotations

import json
from datetime import datetime

from anthropic import Anthropic

from weekforge.debate.debaters import Council
from weekforge.debate.state import DEBATER_NAMES, DebateEvent, DebateState
from weekforge.models import Schedule, TimeBlock


# ── Formatting helpers ──────────────────────────────────────────────────────

def _fmt_tasks(state: DebateState) -> str:
    lines = []
    for t in state["tasks"]:
        line = f"- [{t.id}] {t.title} ({t.estimated_minutes}min, priority {t.priority}"
        if t.deadline:
            line += f", deadline {t.deadline.date()}"
        if t.category:
            line += f", category: {t.category}"
        line += ")"
        lines.append(line)
    return "\n".join(lines) if lines else "No tasks."


def _fmt_busy(state: DebateState) -> str:
    lines = [
        f"- {b.label}: {b.start.strftime('%a %d %b %H:%M')}–{b.end.strftime('%H:%M')}"
        for b in state["busy_blocks"]
    ]
    return "\n".join(lines) if lines else "No fixed commitments."


def _fmt_prefs(state: DebateState) -> str:
    p = state["preferences"]
    return f"Work hours {p.workday_start_hour}:00–{p.workday_end_hour}:00, max focus {p.max_focus_minutes_per_day}min/day"


def _fmt_transcript_tail(state: DebateState, n: int = 12) -> str:
    return "\n".join(
        f"[Round {e['round']} {e['speaker']}] {e['content']}"
        for e in state["transcript"][-n:]
    )


# ── Node factories ──────────────────────────────────────────────────────────

def make_gather_proposals_node(council: Council):
    """Return a LangGraph node that asks each debater to propose a schedule."""

    def gather_proposals(state: DebateState) -> dict:
        new_round = state["round_number"] + 1
        context = (
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


def human_interrupt_node(state: DebateState) -> dict:
    """Pause the graph and wait for human input via LangGraph's interrupt mechanism."""
    from langgraph.types import interrupt

    value = interrupt({
        "type": "needs_human_input",
        "interrupt_reason": state["interrupt_reason"],
        "proposals": state["proposals"],
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
        context = (
            f"Tasks:\n{_fmt_tasks(state)}\n\n"
            f"Proposals:\n{proposals_text}\n\n"
            f"Critiques:\n{critiques_text}"
            f"{human_note}{prev_error}"
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
                    f"Arbiter output:\n{state.get('arbiter_output', '')}\n\n"
                    "Extract a JSON array of time blocks. Each object must have: "
                    "start (ISO 8601 with timezone), end (ISO 8601 with timezone), "
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
                    start=datetime.fromisoformat(b["start"]),
                    end=datetime.fromisoformat(b["end"]),
                    label=b["label"],
                    task_id=b.get("task_id"),
                )
                for b in blocks_data
            ]
            schedule = Schedule(blocks=blocks)
            return {"schedule": schedule, "validation_error": None}
        except Exception as exc:
            error_msg = str(exc)
            event = {
                "round": state["round_number"],
                "speaker": "System",
                "content": f"Schedule parsing failed: {error_msg}. Retrying arbitration.",
                "event_type": "validation_fail",
            }
            return {"schedule": None, "validation_error": error_msg, "transcript": [event]}

    return validate


def finalize_node(state: DebateState) -> dict:
    """Terminal node — passes the validated schedule through unchanged."""
    return {"schedule": state["schedule"]}
