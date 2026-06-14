"""CrewAI council of debaters for WeekForge."""

from __future__ import annotations

from dataclasses import dataclass

from crewai import Agent, Crew, LLM, Process
from crewai import Task as CrewTask


@dataclass
class Council:
    """Holds the four CrewAI agents. Injected into the LangGraph graph at build time."""

    deadline_hawk: Agent
    energy_guardian: Agent
    focus_batcher: Agent
    arbiter: Agent

    def propose(self, agent_name: str, context: str) -> str:
        """Ask one debater to propose a weekly schedule given the context."""
        agent = self._get_agent(agent_name)
        task = CrewTask(
            description=(
                f"Given this planning context:\n{context}\n\n"
                "Propose a weekly schedule that best serves YOUR specific objective. "
                "Be concrete: name which tasks go on which days and at what times. "
                "Explain your reasoning in 2-3 sentences."
            ),
            expected_output="A proposed weekly schedule with task placements and a brief rationale.",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
        result = crew.kickoff()
        return str(result.raw)

    def critique(self, agent_name: str, context: str) -> str:
        """Ask one debater to critique the current round's proposals."""
        agent = self._get_agent(agent_name)
        task = CrewTask(
            description=(
                f"Given these proposals from the council:\n{context}\n\n"
                "Critique the proposals from YOUR perspective. "
                "Be specific: which proposals conflict with your objective and why. "
                "Be direct — this is a debate."
            ),
            expected_output="A specific critique of the proposals highlighting conflicts with your objective.",
            agent=agent,
        )
        crew = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False)
        result = crew.kickoff()
        return str(result.raw)

    def arbitrate(self, context: str) -> str:
        """Ask the Arbiter to synthesise a final schedule from all proposals and critiques."""
        task = CrewTask(
            description=(
                f"Given these proposals and critiques from the council:\n{context}\n\n"
                "Synthesise the BEST POSSIBLE weekly schedule that balances all competing objectives. "
                "Output a JSON array of time blocks. Each block must have: "
                "start (ISO 8601 datetime with timezone), end (ISO 8601 datetime with timezone), "
                "label (task title or description), task_id (task id string or null). "
                "Output ONLY the JSON array, no markdown fences, no explanation."
            ),
            expected_output="A JSON array of time block objects.",
            agent=self.arbiter,
        )
        crew = Crew(agents=[self.arbiter], tasks=[task], process=Process.sequential, verbose=False)
        result = crew.kickoff()
        return str(result.raw)

    def _get_agent(self, name: str) -> Agent:
        mapping = {
            "DeadlineHawk": self.deadline_hawk,
            "EnergyGuardian": self.energy_guardian,
            "FocusBatcher": self.focus_batcher,
        }
        return mapping[name]  # raises KeyError for unknown agents


DEFAULT_MODEL = "anthropic/claude-haiku-4-5-20251001"


def build_council(api_key: str, model: str = DEFAULT_MODEL) -> Council:
    """Build a Council with four Claude-backed CrewAI agents."""
    llm = LLM(model=model, api_key=api_key)

    deadline_hawk = Agent(
        role="Deadline Hawk",
        goal="Ensure every task is completed before its deadline by prioritising urgency above all else",
        backstory=(
            "You are a relentless advocate for hitting deadlines. You have seen projects fail because "
            "teams optimistically deprioritised time-sensitive work. You believe that missing a deadline "
            "is the worst outcome, and that people systematically underestimate time pressure."
        ),
        llm=llm,
        verbose=False,
    )

    energy_guardian = Agent(
        role="Energy Guardian",
        goal="Protect the user from burnout by ensuring adequate breaks and preventing back-to-back high-intensity work",
        backstory=(
            "You are a wellness-focused planner who has witnessed burnout destroy productivity and wellbeing. "
            "You believe that sustainable pacing always beats sprinting, and that rest is as productive as work. "
            "You will always push back on overpacked schedules."
        ),
        llm=llm,
        verbose=False,
    )

    focus_batcher = Agent(
        role="Focus Batcher",
        goal="Minimise context-switching by grouping similar tasks together and protecting long uninterrupted work blocks",
        backstory=(
            "You are a deep-work advocate who has measured the true cost of context-switching. "
            "You believe the enemy of great work is fragmentation. You want similar tasks batched, "
            "meetings clustered, and long focused blocks protected at all costs."
        ),
        llm=llm,
        verbose=False,
    )

    arbiter = Agent(
        role="Neutral Arbiter",
        goal="Synthesise the council's competing proposals into the best possible schedule, weighing trade-offs fairly",
        backstory=(
            "You are a wise mediator who hears all perspectives without bias. "
            "You understand that deadlines, energy, and focus are all legitimate concerns, "
            "and your job is to find the schedule that honours all three as well as possible. "
            "You always explain the trade-offs you accepted."
        ),
        llm=llm,
        verbose=False,
    )

    return Council(
        deadline_hawk=deadline_hawk,
        energy_guardian=energy_guardian,
        focus_batcher=focus_batcher,
        arbiter=arbiter,
    )
