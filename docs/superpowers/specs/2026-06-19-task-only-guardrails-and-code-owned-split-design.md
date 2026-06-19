# Task-only guardrails & code-owned split — design

**Date:** 2026-06-19
**Status:** approved, ready for plan

## Summary

Two coupled fixes to the debate guardrails, exposed by a real run where a
fixed commitment (Badminton, 20:30–22:30, outside the work window and over the
per-block cap) kept failing validation, and an over-long task (Exam Prep) drifted
into nonsensical split labels like `(5/4)` and `(8/4)` across retries.

1. **Bug 1 — guardrails must only police task blocks.** Fixed commitments and
   soft buffer blocks (`task_id is None`) are not focus work; they may run
   outside the work window, exceed the per-block cap, and overlap each other.
   The deterministic guardrail currently judges them like tasks, manufacturing
   failures that burn retries.
2. **Bug 2 — the council, not code, owns how many blocks a task is split into,
   and that count drifts across rounds.** Because frozen blocks are immutable
   and the Arbiter re-derives "how many more blocks does this task still need"
   every scoped-repair round from a partial view, the split count grows
   incorrectly (`(5/4)`, `(8/4)`). The two bugs compound: Bug 1's spurious
   failures cause the extra rounds in which Bug 2's drift accumulates.

The fix moves split **count and per-block durations** into code (the council
still decides *when* each block lands), exempts `task_id is None` blocks from the
per-block guardrails, and enriches the Arbiter's scoped-repair context with the
full constraint set, an authoritative per-task accounting ledger, and the
round transcript.

## Decisions (settled in brainstorming)

1. **Per-block guardrails apply only to blocks with a `task_id`.** Blocks with
   `task_id is None` (re-emitted fixed commitments, buffers) skip the work
   window, busy-overlap, daily-focus-cap counting, week-window, and per-block-cap
   rules. Fixed commitments passed in as `busy_blocks` still constrain task
   blocks (a task may not overlap a busy block).
2. **Code owns the split: both the block count `N` and each block's duration.**
   For a task with `estimated_minutes > max_focus_minutes_per_block`, code
   computes `N = ceil(estimated / cap)` and a duration list that is as even as
   possible, each `<= cap`, summing exactly to `estimated`. The council only
   chooses each block's start time.
3. **Task identity is preserved (one `Task`, one `task_id`, one deadline).** The
   split plan is *derived* from `estimated_minutes` + cap — no task fragmentation,
   no new persistent state. (Chosen over splitting into N child tasks, which
   fragments deadline/priority/dependencies.)
4. **The Arbiter sees more, layered on top of the existing freeze mechanism.**
   Full constraints, a per-task ledger ("placed X of N blocks → complete / needs
   M more"), and the round transcript ride into scoped repair. This deliberately
   does **not** abandon incremental freezing for full per-round re-derivation —
   that path is the one CLAUDE.md records as oscillating.

## Why this respects the termination red line

Bug 2's structural fix keeps the bounded `arbitrate↔validate` scoped-repair
loop intact. The new per-task conformance rule rides that loop exactly like the
existing rules; `max_validation_attempts` still bounds it, and `finalize` still
delivers best-effort on exhaustion. We are *narrowing* the space of valid
schedules (count + durations are now fixed), which makes convergence easier, not
harder.

## Changes

### Phase 1 — Bug 1: task-only guardrails

**`src/weekforge/debate/validation.py` — `classify_blocks`.**

Guard each per-block rule so it runs only when `block.task_id is not None`:

- Rule 2 (work window / cross-midnight)
- Rule 3 (busy-block overlap)
- Rule 5 (week window)
- Rule 6 (per-block focus cap)

And in the day-level **Rule 4 (daily focus cap)**, only count minutes from
blocks with a `task_id` toward the per-day total, and only flag `task_id`
blocks on an over-cap day.

Rule 1 (unknown `task_id`) is unchanged — it already only fires when `task_id`
is not None.

Net effect: a `task_id is None` block (a re-emitted Badminton, a "Recovery and
buffer" span) is always clean and freezable. The 839-minute buffer no longer
consumes the focus budget; Badminton no longer self-overlaps or trips the cap.

Accepted trade-off: a `task_id is None` block that overlaps a real task block is
no longer reported. This is acceptable — `busy_blocks` inputs still block tasks,
and buffers are soft annotations.

### Phase 2 — Bug 2: code-owned split + richer Arbiter context

**1. Split-plan helper — `validation.py` (pure).**

```python
def block_plan(estimated_minutes: int, cap: int) -> list[int]:
    """Durations for one task's focus blocks: each <= cap, summing to estimate,
    as even as possible. Returns [estimated] when it already fits in one block."""
```

`N = ceil(estimated / cap)`, even distribution (e.g. `170, cap 45 -> [43,43,42,42]`).
Stateless — derivable any time from `task.estimated_minutes` + the per-block cap.

**2. Per-task conformance — new rule in `classify_blocks`.**

After the per-block rules, aggregate blocks by `task_id`. For each known task,
the multiset of its blocks' `duration_minutes` must be a **sub-multiset** of
`block_plan(task)`:

- **Over-placement or wrong durations = drift** (e.g. 5 blocks for a 4-block
  plan, a 60-min block when the plan has only 45s) → the task **fails
  conformance**; mark all of its blocks broken.
- **Under-placement = shortfall** (fewer planned blocks placed, sum below
  estimate) → the task still **conforms**. This is the physically-unschedulable
  case; forcing a retry here would risk the termination red line, so it is
  surfaced through the existing non-blocking `underscheduled_tasks` warning
  instead (unchanged behaviour).

**All-or-nothing freezing:** a task freezes as a unit only when none of its
blocks is individually broken (rules 1–6) *and* it does not drift. If either
holds, mark **every** block of that task broken so the whole task re-places
together (mirroring how an over-cap day marks all its blocks `to_fix`). This
keeps a task fully-frozen or fully-broken, which is what makes the task-keyed
merge below sound.

**3. Freeze merge keyed by `task_id` — `nodes.py` validate node.**

Today the frozen merge dedupes by `label` (`nodes.py:420-424`), which is why
`(1/4)` and `(5/4)` both survive. Because conformance makes freezing
all-or-nothing per task, change the merge to:

- a frozen block with a `task_id` is authoritative; drop any model re-emission
  carrying that `task_id`;
- a frozen `task_id is None` block keeps the existing label-based dedupe.

This removes the label-collision fragility at its root.

**4. Labels.**

The Arbiter is instructed to label split blocks `f"{title} ({i}/{N})"` for
`i in 1..N` (just `title` when `N == 1`). Structural correctness no longer
depends on labels — conformance is by **count + duration**, so the drift that
produced `(5/4)`/`(8/4)` is caught by the count check regardless of how the
block is labelled. Labels are therefore presentational; code does not enforce
them (YAGNI).

**5. Arbiter prompt + scoped-repair context — `nodes.py`.**

- Arbitrate context (first pass and scoped): for each over-long task, state the
  exact plan — *"Exam Prep must be placed as 4 blocks of 43, 43, 42, 42 min,
  labelled (1/4)…(4/4); choose only their start times."*
- Scoped-repair feedback (`_scoped_repair_feedback`) gains:
  - the **full constraint set** (work window, daily cap, per-block cap), not just
    the per-day budget;
  - a **per-task ledger**: *"Interview Prep: 0 of 4 blocks placed → place all 4.
    Exam Prep: 4 of 4 placed → COMPLETE, add none."* Derived from the frozen
    blocks + each task's plan;
  - the **round transcript tail** (carried via the existing `_fmt_transcript_tail`),
    which scoped repair currently drops.

## Persistence / API / frontend

No changes. The split plan is derived at debate time from existing fields; no new
`Preferences`, `Task`, request, or storage shape. `X-WEEKFORGE:1` and every ICS
path are untouched.

## Testing (TDD — failing test first for each)

**Phase 1 (`tests/debate/test_validate_blocks.py`, `test_validation.py`):**
- A `task_id is None` block outside the work window / over the per-block cap /
  overlapping another null block is **clean and freezable**.
- A `task_id is None` block does **not** count toward the daily focus cap.
- Task blocks are still policed exactly as before (regression guard).

**Phase 2:**
- `block_plan`: `90, cap 90 -> [90]`; `180, cap 90 -> [90,90]`;
  `170, cap 45 -> [43,43,42,42]` (each `<= cap`, sums to estimate).
- Conformance: a task with too many blocks (e.g. 5 for a 4-block plan) or a
  duration not in its plan marks **all** its blocks broken; a task whose blocks
  are a sub-multiset of its plan conforms; an under-placed task conforms and is
  reported by the existing non-blocking warning, not failed.
- All-or-nothing: a task with one block outside the window has **all** its
  blocks marked to re-place together.
- Freeze merge: a model re-emission carrying a frozen `task_id` is dropped; a
  null-task block still dedupes by label.
- Arbitrate context includes the per-task plan and (in scoped repair) the ledger
  + transcript. Node tests mock `weekforge.debate.nodes.Anthropic`; never call the
  real API.
- End-to-end regression mirroring the bug report: Badminton + Interview Prep
  (4×45) + Exam Prep converge **without** `(5/4)`-style drift.

## Alternatives considered (not chosen)

- **Keep LLM-owned count, feed an authoritative budget ledger only** (mitigation,
  not a structural guarantee — labels still LLM-authored, drift still possible).
  Rejected in favour of code-owned count + durations.
- **Split each over-long task into N child `Task`s** — deterministic but fragments
  deadline/priority/dependencies and complicates downstream accounting. Rejected;
  derive the plan instead, keeping one identity.
- **Abandon freezing; re-derive the whole schedule each round with full history**
  — closest to "Arbiter sees everything", but is the documented oscillation /
  non-termination path. Rejected.

## Red lines respected

- No calendar write access; `X-WEEKFORGE:1` and all ICS paths untouched.
- Debate still terminates: the new conformance rule rides the bounded
  scoped-repair loop; `max_validation_attempts` + best-effort path intact.
- Arbiter still emits local wall-clock with no offset; `validate` still merges
  authoritative frozen blocks in code (now keyed by `task_id`).
- Built test-first.
