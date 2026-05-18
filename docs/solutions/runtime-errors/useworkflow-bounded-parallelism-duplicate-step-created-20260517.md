---
title: 'useworkflow runtime emits duplicate `step_created` events when a workflow body uses `pLimit + Promise.allSettled` over `"use step"` calls'
category: runtime-errors
module: apps/admin
date: 2026-05-17
last_updated: 2026-05-17
tags:
  - useworkflow
  - workflow-runtime
  - bounded-parallelism
  - p-limit
  - corrupted-event-log
  - replay-determinism
  - scene-embedding-backfill
  - transcript-embedding-backfill
problem_type: runtime_error
component: background_job
root_cause: async_timing
resolution_type: code_fix
severity: high
applies_when: >
  A useworkflow `"use workflow"` body dispatches `"use step"` functions
  through a bounded-parallelism pattern such as `pLimit(N) +
  Promise.allSettled(groups.map(g => limit(() => step(g))))`. The
  runtime emits duplicate `step_created` events for the FINAL batch of
  pLimit-bounded parallel step dispatches AFTER those steps complete,
  tripping its `Unconsumed event in event log` corruption guard and
  failing the whole run. Sequential `for…of` dispatch is the workaround
  until useworkflow handles parallel step calls under this pattern.
  Reproduced empirically against `@workflow/world-postgres` v4.1.1
  (admin worker) on 2026-05-17 with both
  `runSceneEmbeddingBackfill` and `runTranscriptEmbeddingBackfill`.
---

## Problem

useworkflow's runtime fails an entire workflow run with `WorkflowRuntimeError: Unconsumed event in event log` whenever a `"use workflow"` body uses bounded-parallelism (`pLimit(N) + Promise.allSettled(...)`) to dispatch `"use step"` functions in parallel. The failure happens AFTER work has been done — many steps complete successfully — but the runtime trips its corruption guard and reports the entire run as failed.

## Symptoms

- The workflow run finishes with status `failed` and `error_cbor` containing:
  > `Unconsumed event in event log: eventType=step_created, correlationId=step_<ULID>, eventId=wevt_<ULID>. This indicates a corrupted or invalid event log. Learn more: https://workflow-sdk.dev/err/corrupted-event-log`
- The GraphQL trigger mutation returns `INTERNAL_SERVER_ERROR` because the Pothos resolver awaits `run.returnValue` which rejects with `WorkflowRuntimeError`.
- Inspecting `workflow.workflow_events` for the failed run reveals: the FINAL batch of pLimit-bounded `step_created` events appears TWICE — once at dispatch time, then a second time at workflow-body-completion time (after the originals' `step_completed` events have already fired). The second copy has no matching `step_started`/`step_completed`, which is what the runtime guard flags.
- The error is uncatchable inside the workflow body — `try/catch` around `await Promise.allSettled(...)` cannot intercept it.
- No partial work is committed to the destination DB: the workflow body's per-target DB writes happen inside `processGroup`'s `$transaction`, which only commits when the step returns successfully; the runtime-level corruption error fires AFTER the step completes (during the workflow body's post-step bookkeeping), so committed work CAN persist even when the run is marked failed. **Inspect destination tables before declaring a run "no data written" — assume idempotent reruns will reconcile, but verify.**

## What didn't work

- **"It's a transient runtime bug. Retry."** The same failure mode reproduced across 2 separate dispatches of R1 (`runSceneEmbeddingBackfill`) and R2 (`runTranscriptEmbeddingBackfill`) on 2026-05-17. Not flaky.
- **"The bug is in admin's workflow body code."** No — the body's `pLimit(5) + Promise.allSettled` shape is exactly the canonical pattern that
  [`bounded-parallelism-per-target-workflow-pattern-20260505.md`](../best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md)
  documents. R3's sibling workflow (`runExperienceEmbeddingBackfill`) uses sequential `for…of` and completes successfully on the same runtime with no duplicate events.
- **"Restart the worker."** Doesn't help — the corruption is in the persistent event-log table (`workflow.workflow_events`), not worker memory. Subsequent dispatches create new `run_id` records and the corruption recurs deterministically for any pLimit-bounded dispatch pattern.
- **"Clear stale events from `workflow.workflow_events` for the failed runs."** Could be done as cleanup, but doesn't prevent the next dispatch from corrupting its own event log the same way.
- **Reading useworkflow's documented [`corrupted-event-log`](https://workflow-sdk.dev/err/corrupted-event-log) page.** The page describes three documented causes (duplicate completion events, orphaned completion events, events after terminal state) but does NOT cover orphaned `step_created` events specifically. The interaction with `pLimit + Promise.allSettled` is undocumented as of 2026-05-17.

## Solution — sequential `for…of` over groups

Convert the workflow body's per-target dispatch from bounded parallelism to sequential `for…of`. Wrap each step call in a try/catch so an unexpected throw produces a synthetic-failed cascade for the affected group's targets without aborting the loop.

**Before** (R1 / R2 prior to 2026-05-17 hotfix):

```ts
const limit = pLimit(env.SCENE_EMBEDDING_CONCURRENCY ?? 5)
const settled = await Promise.allSettled(
  groups.map((group) => limit(() => processGroup(group))),
)
const outcomes = settled.flatMap((result, i) => {
  const group = groups[i]!
  if (result.status === "fulfilled") return result.value
  // synthetic-failed cascade for the WHOLE group
  return group.targets.map((target) => synthesizeFailed(target, result.reason))
})
```

**After**:

```ts
const outcomes: BackfillOutcome[] = []
for (const group of groups) {
  const groupStartedAt = Date.now()
  try {
    const groupOutcomes = await processGroup(group)
    outcomes.push(...groupOutcomes)
  } catch (err) {
    // Synthetic-failed cascade for the WHOLE group — a thrown error
    // past `processGroup`'s defensive branch is a step-plumbing fault
    // and should not aggregate as "one of the locales failed"; every
    // locale in the affected group lost its work.
    const reason = err instanceof Error ? err.message : String(err)
    const durationMs = Date.now() - groupStartedAt
    for (const target of group.targets) {
      const synthetic: BackfillOutcome = {
        status: "failed",
        target,
        locale: target.locale, // or `language` for R2
        reason,
        durationMs,
      }
      logOutcome(synthetic)
      outcomes.push(synthetic)
    }
  }
}
```

Trade-off:

- **Wall-clock cost:** sequential dispatch is ~N× slower than `pLimit(N)`. For admin's R1 backfill (~1094 videos × few locales each ≈ ~3-5k targets at ~5s/target), sequential ≈ 5-7 hours vs pLimit(5) ≈ 1-1.5 hours. Acceptable for a one-time backfill; revisit if backfill cadence increases.
- **Per-target error isolation preserved.** `processGroup`'s internal try/catch still fires; the outer for-loop's try/catch catches the rare step-plumbing throw.
- **`logOutcome` defensive try/catch stays as-is.** Per
  [`in-memory-slot-reservation-fire-and-forget-20260506.md`](../best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md)
  the JSON.stringify-throw defensive guard is independent of parallelism.

## Why this works

useworkflow's event-log replay treats each `"use step"` call from a workflow body as a deterministic ordering operation. The runtime emits `step_created` events as steps are dispatched, expecting each to be matched by a `step_started`/`step_completed` event pair. With sequential `for…of`, every step's lifecycle (`step_created` → `step_started` → `step_completed`) completes before the next step's `step_created` fires — strict ordering, no overlap, no duplicate emissions.

With `pLimit(N) + Promise.allSettled`, the workflow body returns when all promises settle, but the runtime's internal bookkeeping for the FINAL batch of pLimit-deferred parallel calls re-emits `step_created` events AFTER the steps' completion events have already been written. The runtime's "consume in order" guard then sees an unconsumed `step_created` event for a step that's already terminal → corruption error.

The exact mechanism (whether useworkflow emits these duplicates from the workflow-body wrapper, the pLimit closure, or the `Promise.allSettled` post-resolution callback) is internal to useworkflow and not exposed at the application surface. The empirical fix — eliminate bounded parallelism inside a workflow body — sidesteps the trigger entirely.

## Prevention

### Codified rule

> **Workflow bodies dispatch `"use step"` calls sequentially via `for…of`. Do NOT use `pLimit + Promise.allSettled`, `Promise.all`, or any other parallel-dispatch construct inside a workflow body.**

### Lint / test invariant (proposed)

A test could parse each `apps/admin/src/workflows/*.ts` file's AST and assert no `"use workflow"`-decorated function contains `Promise.allSettled` or `pLimit` references in its body. Sketch:

```ts
// apps/admin/src/workflows/__tests__/no-bounded-parallelism-in-workflow-body.test.ts
it("no workflow body uses pLimit or Promise.allSettled", () => {
  const workflowFiles = glob.sync("apps/admin/src/workflows/*.ts")
  for (const file of workflowFiles) {
    const src = readFileSync(file, "utf8")
    if (!src.includes('"use workflow"')) continue
    expect(
      src,
      `${file} contains pLimit (forbidden in workflow body)`,
    ).not.toMatch(/\bpLimit\b/)
    expect(
      src,
      `${file} contains Promise.allSettled (forbidden in workflow body)`,
    ).not.toMatch(/\bPromise\.allSettled\b/)
  }
})
```

### Affected pattern docs to update

- [`bounded-parallelism-per-target-workflow-pattern-20260505.md`](../best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md) — **mark as superseded.** The "canonical HOW" it documents is incompatible with useworkflow's event-log replay. Future workflow authors should NOT use this pattern.
- [`parallel-workflow-error-robustness-20260420.md`](../best-practices/parallel-workflow-error-robustness-20260420.md) — still applies for non-workflow contexts (regular `Promise.allSettled` in non-`"use workflow"` code is fine).

### What to watch for in CI

After this hotfix lands, monitor admin's prod Railway logs for `WorkflowRuntimeError: Unconsumed event in event log` — recurrence means another workflow has accidentally reintroduced parallelism. The lint test above is the durable guard.

## Diagnostic recipe (recorded for future incidents)

Step 1: Confirm the corruption pattern.

```sql
-- Are there duplicate step_created events for the same correlation_id?
SELECT correlation_id, COUNT(*) AS n
FROM workflow.workflow_events
WHERE run_id = '<wrun_id>'
  AND type = 'step_created'
GROUP BY correlation_id
HAVING COUNT(*) > 1;
```

Step 2: Get the timeline for one duplicate.

```sql
SELECT id, type, created_at
FROM workflow.workflow_events
WHERE correlation_id = '<step_id>'
ORDER BY created_at;
-- If you see step_created → step_started → step_completed → step_created,
-- it's the bounded-parallelism duplicate-emission bug. The 4th event
-- (second step_created) is the runtime's "Unconsumed event".
```

Step 3: Check the parallelism shape of the affected workflow.

```bash
grep -n "pLimit\|Promise.allSettled" apps/admin/src/workflows/<workflow>.ts
```

If pLimit + Promise.allSettled inside a `"use workflow"` body — this is the bug. Apply the sequential `for…of` workaround.

## Pointers

- Worked example of the fix: PR landing `2026-05-18` reverting R1 + R2 to sequential `for…of`.
- Affected workflows: `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`, `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`.
- Sibling that doesn't trip the bug (sequential by design): `apps/admin/src/workflows/experienceEmbeddingBackfill.ts`.
- Empirical evidence: prod runs `wrun_01KRW4ZYE5S1V814MKRSJG3GK5` (R1) and `wrun_01KRW4ZYAJNR5PMMRKJE2ZYPGS` (R2) on 2026-05-17, both with 5+ duplicate `step_created` events for the final pLimit batch.
- useworkflow docs page that does NOT cover this case: <https://workflow-sdk.dev/err/corrupted-event-log>.
- Sibling solutions doc now superseded: [`bounded-parallelism-per-target-workflow-pattern-20260505.md`](../best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md).
- Sibling solutions doc still valid (non-workflow contexts): [`parallel-workflow-error-robustness-20260420.md`](../best-practices/parallel-workflow-error-robustness-20260420.md).
