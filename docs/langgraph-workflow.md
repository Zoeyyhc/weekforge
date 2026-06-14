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
    G -->|valid JSON| H
    G -->|parse error, retry| F
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
| `arbitrate` | Arbiter synthesises all proposals and critiques into a JSON time-block array | CrewAI |
| `validate` | Parses Arbiter's free-text output into valid JSON; loops back to `arbitrate` with the error on failure | Claude Haiku |
| `finalize` | Writes Schedule to state; SSE pushes it to the frontend calendar view | LangGraph |

## Color Key

- **Purple** — CrewAI agents (debaters + Arbiter); model configured via `WEEKFORGE_MODEL`, defaults to Haiku
- **Blue** — Claude Haiku utility calls (convergence check = 10 tokens; validate = JSON parsing)
- **Green** — LangGraph infrastructure (interrupt checkpoint + finalize terminal node)
