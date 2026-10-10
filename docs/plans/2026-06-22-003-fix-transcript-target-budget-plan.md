---
title: "fix: Defer transcript targets inside oversized backfill groups"
type: fix
date: "2026-06-22"
---

# fix: Defer transcript targets inside oversized backfill groups

## Summary

The first June 22 workflow hotfix bounded process waves between groups, but a
scoped `1_jf-0-0` resume showed one `(video, edition)` group can still contain
hundreds of language targets. The hotfix will keep production batches as
target-limited group chunks, then stop launching additional language targets
inside a group once the next target launch cannot safely fit inside the
durable step budget.

---

## Problem Frame

Production run `wrun_01KVPQTTTQJGSWKET22FB3V156` was started as the intended
scoped recovery shape: `MODEL_UPGRADE`, `coreIds: ["1_jf-0-0"]`, and no
language filter. Early process and confirm steps were healthy, but a later
process step again approached the workflow task-boundary corruption shape.

The remaining gap was both batching shape and inner-loop runtime. The outer
process step now defers later group waves, but `1_jf-0-0` is one large group
whose `targets` loop can still launch many language targets sequentially inside
one durable step. The production batcher must therefore preserve bounded
multi-target group chunks instead of converting every target into a singleton
group, otherwise the target-loop guard would not be exercised by the normal
GraphQL trigger path.

---

## Requirements

- R1. A process step must not start another language target inside a group when
  the configured launch timeout plus safety buffer cannot fit inside the
  remaining step budget.
- R2. The first target in a group must remain eligible so a tight budget cannot
  deadlock the workflow.
- R3. Remaining targets from a partially processed group must be returned as an
  `unprocessedGroup` so the workflow can continue in a fresh durable step.
- R4. Existing `MODEL_UPGRADE` resume health checks must keep skipping only
  already-enriched healthy rows.
- R5. Production batching must preserve target-limited multi-target group
  chunks, rather than singleton groups, so the inner target-loop guard is
  reachable from the existing backfill trigger.
- R6. The compound learning and operations runbook must record that nested
  provider-launch loops need the same runtime guard as outer waves.

---

## Key Technical Decisions

- **Guard every launch boundary:** The same projected-runtime rule applies both
  between group waves and inside a group's target loop. If a loop can call
  Mastra, it can consume the full launch timeout.
- **Preserve bounded group chunks:** The batcher still caps step inputs by
  target count, but it keeps contiguous targets from the same `(video, edition)`
  together until the target limit is reached. This restores source-artifact
  reuse and makes the inner target-loop guard part of the production path.
- **Return remainder at the same granularity:** When the target loop stops, the
  result carries the same group identity with `targets` sliced to the
  unprocessed language targets.
- **Keep resume scoped:** After deploy, retry only the known failed core id
  with no language filter. Healthy enriched rows should skip from storage state
  instead of being re-embedded.

---

## Implementation Units

### U1. Defer Remaining Targets Within One Group

- **Goal:** Bound `processTranscriptEmbeddingGroup` runtime when a single group
  contains many language targets.
- **Requirements:** R1, R2, R3, R4, R5.
- **Dependencies:** Existing projected runtime helper from
  `apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts`.
- **Files:** `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`,
  `apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts`,
  `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts`.
- **Approach:** Preserve target-limited group chunks in
  `batchGroupsByTargetLimit`. Track how many targets have started inside the
  group. Before starting later targets, compare elapsed step time against the
  launch timeout and safe step budget. Return outcomes, pending confirmations,
  and the sliced unprocessed group when the next target no longer fits.
- **Test scenarios:** A four-language group whose first target consumes most of
  the budget processes only the first target and returns the remaining three
  languages as one unprocessed group. A pending ingest confirmation from the
  processed target is preserved while the remaining targets are deferred. The
  production batcher turns a six-language group into target-limited chunks, not
  singleton groups. Existing process-wave, resume-skip, and pending-confirmation
  tests continue to pass.
- **Verification:** Focused Admin workflow tests pass.

### U2. Update Operational Learning

- **Goal:** Preserve the production failure shape and the target-loop fix for
  future operators and agents.
- **Requirements:** R6.
- **Dependencies:** U1.
- **Files:** `docs/solutions/workflow-issues/budget-durable-workflow-steps-by-projected-runtime.md`,
  `docs/solutions/workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md`.
- **Approach:** Update the existing projected-runtime compound note instead of
  creating a duplicate learning. Add an operations checkpoint for the cancelled
  scoped run and the expected retry signal.
- **Test scenarios:** Documentation-only update.
- **Verification:** Compound frontmatter validation passes for modified
  solution notes.

---

## Risks & Dependencies

- A single very slow first target can still consume the configured launch
  timeout. The guard prevents follow-on launches from compounding that delay; a
  detached Mastra launch/status model remains separate follow-up work.
- The retry must wait until both `@forge/admin` and `@forge/admin/worker` are
  deployed, because the workflow body runs on the worker service.

---

## Operational Notes

Before this hotfix is deployed, do not retry the scoped `1_jf-0-0` resume. The
previous scoped run was cancelled after 56 transcript rows were touched and no
new transcript writes were observed in the later containment window.

After deploy, use the existing Admin GraphQL mutation with
`mode: MODEL_UPGRADE`, `coreIds: ["1_jf-0-0"]`, and no language filter. The
expected proof is that process steps complete below the worker boundary and
healthy enriched language rows skip instead of relaunching Mastra.
