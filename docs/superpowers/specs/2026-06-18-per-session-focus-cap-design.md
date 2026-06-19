# Per-session focus cap — design

**Date:** 2026-06-18
**Status:** approved, ready for plan

## Summary

Add a new rhythm preference, **max single focus duration**
(`max_focus_minutes_per_block`), to the pre-debate `Preferences`. It caps how
long any single scheduled focus block may run, distinct from the existing
*daily* cap `max_focus_minutes_per_day`. A 90-minute default applies — and,
because it is a hard guardrail, applies retroactively to existing saved
preferences.

## Decisions (settled in brainstorming)

1. **Hard guardrail, not advisory.** The cap is enforced deterministically in
   `classify_blocks` like the daily cap, not left to the council's discretion.
2. **Default 90 minutes**, retroactive to existing saved rhythms (accepted).
3. **The council splits over-long tasks, via prompt** — not code. A 180-minute
   task under a 90-minute cap is re-placed by the Arbiter as multiple blocks
   sharing one `task_id`. Code never fabricates or splits blocks.
4. **A non-blocking reconciliation warning** flags work the split may have
   silently dropped, without forcing a retry (which would risk the
   "debate must terminate" red line on physically-unschedulable tasks).

## Why hard vs. why the council splits

The cap belongs in the same **Tier 1** as the work window, the busy-overlap
rule, and the daily cap: absolute floors that must all hold simultaneously,
with no precedence ordering among them. The soft preferences
(`priority`, `deadline`, `preferred_days`) are negotiated *above* that floor by
the debaters and the Arbiter and are never code-enforced.

Splitting is left to the council because — unlike `_localize`, which is a pure
representation fix with exactly one correct answer — splitting is a *scheduling
decision* with many valid answers, globally entangled with every other
constraint (daily cap, busy blocks, window, deadlines, competing tasks). The
moment code splits, it must place, and placement is the debate's entire purpose.
Pre-chunking tasks before the debate is a defensible deterministic alternative
(see Alternatives) but fragments task identity/deadlines and hard-codes a
chunking granularity; it was not chosen.

## Changes

### 1. Data model — `src/weekforge/models.py`

Add to `Preferences`:

```python
max_focus_minutes_per_block: int = Field(default=90, gt=0)
```

Extend the existing `model_validator` (or add one) so that
`max_focus_minutes_per_block <= max_focus_minutes_per_day` — a per-block cap
larger than the daily cap is nonsensical and would confuse the council. Raise
`ValueError` otherwise.

### 2. Hard guardrail — `src/weekforge/debate/validation.py`

Add **Rule 6** inside the per-block loop of `classify_blocks`: when
`block.duration_minutes > preferences.max_focus_minutes_per_block`, append an
error to that block's `BlockReport`, e.g.:

```
Block 'Report': 180min exceeds 90min single-focus cap
```

The block is then non-`frozen`, flows into `report.to_fix`, and the existing
scoped-repair path re-places it. `validate_blocks` (the flat wrapper) surfaces
it for free. The `max_validation_attempts` cap still bounds the loop — no
termination-red-line risk.

### 3. Non-blocking reconciliation — `validation.py` + `nodes.py`

Add a pure helper to `validation.py`:

```python
def underscheduled_tasks(
    blocks: list[TimeBlock], tasks: list[Task]
) -> dict[str, tuple[int, int]]:
    """Per task_id: (scheduled_minutes, estimated_minutes) where scheduled < estimated."""
```

It sums each task's block minutes by `task_id` and returns only the tasks whose
scheduled total falls short of `estimated_minutes`.

In `make_validate_node`'s **success path** (`nodes.py` ~line 450, where
`report.ok` is true), call `underscheduled_tasks`. If it returns anything,
populate `validation_warnings` with a human-readable note (e.g.
`"Report: only 90 of 180min scheduled"`) **without** setting `degraded` and
**without** forcing a retry. The warning rides the `DoneMsg` to the frontend.
`report.ok` is unchanged — reconciliation never blocks convergence.

### 4. Arbiter prompt — `src/weekforge/debate/nodes.py`

- `_fmt_prefs` (~line 64): append the single-focus cap, e.g.
  `… max single focus {p.max_focus_minutes_per_block}min`.
- The arbitrate node's HARD SCHEDULING CONSTRAINTS list (~line 359): add a
  bullet —
  > No single block may exceed `{max_focus_minutes_per_block}` minutes. Split a
  > longer task into multiple blocks that share the same `task_id`, each with a
  > **distinct label** (e.g. `Report (1/2)`, `Report (2/2)`).

  The distinct-label instruction is essential: the frozen-block merge at
  `nodes.py:420` dedupes by `label`, so two re-emitted split blocks sharing a
  frozen block's label would be silently dropped.

### 5. Persistence — `src/weekforge/auth/store.py` (no code change)

Preferences are stored via `Preferences.model_validate_json`. Rows written
before this field deserialize with the default (90). Add a test asserting an
old-shape JSON loads with `max_focus_minutes_per_block == 90`.

### 6. API schema — `src/weekforge/api/schemas.py` (no code change)

`StartDebateRequest.preferences` is the `Preferences` model itself; the new
field rides along. Optional: assert it round-trips in an API test.

### 7. Frontend

- `frontend/lib/types.ts` — add `max_focus_minutes_per_block?: number` to
  `PreferencesInput`.
- `frontend/lib/buildRequest.ts` — add `maxFocusPerBlock: string` to
  `PrefsDraft`; map it into `preferences.max_focus_minutes_per_block`. Default
  draft value `"90"`.
- `frontend/components/TaskForm.tsx` — add a fourth `PrefCard` in the rhythm
  step (step 2): label `🔥 Per Session`, hint `min / block`,
  `data-testid="pref-focus-block"`, `aria-label="Max focus minutes per block"`.
  Change the grid from `sm:grid-cols-3` to `sm:grid-cols-2` (2×2 reads better
  than four cramped columns). Update the `defaultPrefs`/draft initializer and
  wherever saved rhythms hydrate the draft to include the new field.

## Testing (TDD — failing test first for each)

- `tests/.../test_validate_blocks.py`
  - Rule 6: a block over the cap is reported broken / non-frozen; a block at or
    under the cap is unaffected.
  - `underscheduled_tasks`: returns short tasks, omits fully-scheduled ones,
    sums multiple blocks per `task_id`.
- Models test: validator rejects `per_block > per_day`; accepts equal/less.
- Store test: old-shape preferences JSON loads with default 90.
- `frontend/lib/buildRequest.test.ts`: draft maps to
  `max_focus_minutes_per_block`.
- `frontend` `TaskForm` test: the fourth rhythm card renders and updates state.

## Alternatives considered (not chosen)

- **Code-split output blocks** — deterministic but either cosmetic (no break, so
  the wellness intent is lost) or requires re-placement (the council's job, and
  risks code fabricating invalid blocks). Rejected.
- **Pre-chunk tasks before the debate** — deterministic and keeps placement with
  the council, but fragments task identity, deadlines, and dependencies and
  hard-codes a chunking granularity (why 2×90 not 3×60; awkward remainder
  stubs). Defensible; not chosen.
- **Blocking reconciliation (hard `>= estimate`)** — risks the termination red
  line for physically-unschedulable tasks (e.g. 600min task, 360min/day cap,
  short week) by forcing degraded every run. Rejected in favour of a warning.

## Red lines respected

- No calendar write access; `X-WEEKFORGE:1` marker untouched (no ICS change).
- Debate still terminates: Rule 6 rides the bounded scoped-repair loop;
  reconciliation is non-blocking.
- Guardrail invariants intact: Arbiter still emits local wall-clock with no
  offset; `validate` still merges authoritative frozen blocks in code.
- Built test-first.
