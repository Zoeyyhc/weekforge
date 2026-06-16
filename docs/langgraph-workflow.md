# WeekForge — LangGraph Workflow

三个 CrewAI debater → 收敛检测 → Arbiter 仲裁 → 验证 → 输出排期

```mermaid
flowchart TD
    A([Start]) --> B
    B[gather_proposals] --> C
    C[critique] --> D
    D{check_convergence}
    E[human_interrupt]
    F[arbitrate]
    G{validate}
    H[finalize]
    Z([End])

    D -->|converged| F
    D -->|more rounds| B
    D -->|stalled, human required| E
    D -->|stalled, auto| F
    E -->|human input| F
    F --> G
    G -->|valid| H
    G -->|invalid, retry| F
    G -->|retries exhausted, best-effort| H
    H --> Z

    classDef crewai fill:#3b0764,stroke:#7c3aed,color:#e9d5ff
    classDef haiku  fill:#0c4a6e,stroke:#0284c7,color:#bae6fd
    classDef infra  fill:#064e3b,stroke:#059669,color:#a7f3d0
    classDef entry  fill:#1e293b,stroke:#475569,color:#94a3b8

    class B,C,F crewai
    class D,G haiku
    class E,H infra
    class A,Z entry
```

## Node Reference

| Node | Role | Implementation |
|---|---|---|
| `gather_proposals` | DeadlineHawk / EnergyGuardian / FocusBatcher each propose a weekly schedule | CrewAI |
| `critique` | Each debater critiques the others' proposals | CrewAI |
| `check_convergence` | Judges if proposals have converged (yes/no); triggers human interrupt or auto-arbitration on stall | Claude Haiku |
| `human_interrupt` | Pauses graph execution via `langgraph.interrupt()`, waits for user input over SSE | LangGraph |
| `arbitrate` | Arbiter synthesises all proposals and critiques into a JSON time-block array in **local wall-clock time (no UTC offset)**; on a scoped retry it re-places only the blocks flagged broken | CrewAI |
| `validate` | Parses the Arbiter's output, attaches the correct DST offset to its wall-clock times, then semantically validates (work window, no busy-block overlaps, daily focus cap, no cross-midnight, **within the now-aware schedulable week window**); on failure freezes the valid blocks and loops back to `arbitrate` to re-place only the broken ones, bounded by `max_validation_attempts` (default 3) | Claude Haiku |
| `finalize` | Writes the Schedule to state. If validation never passed within the retry cap, delivers the last parseable best-effort schedule flagged `degraded` (with `validation_warnings`). SSE pushes the result to the frontend calendar view | LangGraph |

## Color Key

- **Purple** — CrewAI agents (debaters + Arbiter); model configured via `WEEKFORGE_MODEL`, defaults to Haiku
- **Blue** — Claude Haiku utility calls (convergence check = 10 tokens; validate = JSON parsing)
- **Green** — LangGraph infrastructure (interrupt checkpoint + finalize terminal node)
