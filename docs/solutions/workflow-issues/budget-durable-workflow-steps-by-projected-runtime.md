---
title: "Budget durable workflow steps by projected runtime"
date: "2026-06-22"
last_updated: "2026-06-22"
category: workflow-issues
module: apps/admin transcript embedding backfill
problem_type: workflow_issue
component: background_job
severity: high
applies_when:
  - "A useworkflow step launches external work whose timeout can approach the worker task boundary"
  - "A backfill step is already payload-bounded but still fails with duplicate or unconsumed step events"
  - "A durable workflow needs to resume remaining work without rewriting already-healthy rows"
tags:
  - admin
  - useworkflow
  - graphile
  - backfill
  - transcript-embeddings
  - step-runtime
  - hotfix
---

# Budget durable workflow steps by projected runtime

## Context

The enriched transcript embedding backfill had already been fixed to keep
confirm-ingest payloads bounded before entering useworkflow steps. A scoped
resume for `1_jf-0-0` still reproduced the Graphile/useworkflow event-log
corruption shape: the process step accumulated duplicate `step_started` events
and the parent run became poisoned even though individual Mastra launches and
Admin ingests could continue.

Production evidence showed one `stepProcessTranscriptEmbeddingGroups` attempt
ran for about 316 seconds, crossing the worker task boundary. The step was
target-bounded, but one process step could still launch more than one Mastra
wave. The guard checked elapsed time before a wave; it did not reserve enough
budget for the next wave's launch timeout plus worker overhead.

A follow-up scoped resume for `1_jf-0-0` exposed the same lesson one level
deeper. The outer process-wave guard bounded work between groups, but
`1_jf-0-0` is one large `(video, edition)` group with many language targets.
`processTranscriptEmbeddingGroup` could still launch those targets
sequentially inside one durable step. The projected-runtime guard therefore has
to apply to every nested loop that can launch provider work, not only to the
outer batch loop.

During review of that follow-up hotfix, the production batcher shape mattered
as much as the guard. If `batchGroupsByTargetLimit` rewrites every target into
a singleton group, an inner target-loop guard becomes defensive dead code for
the normal GraphQL trigger path. Keep batches target-limited, but preserve
contiguous multi-target group chunks so the production path exercises the same
loop that owns the provider launches.

## Guidance

For durable steps that launch external work, gate each additional wave by
projected runtime, not only current elapsed time.

Bad shape:

```ts
for (const wave of waves) {
  if (Date.now() - startedAt >= stepMaxDurationMs) break
  await launchWave(wave, launchTimeoutMs)
}
```

The current elapsed time can look safe, while the next launch can still spend
the full request timeout and push the step over the worker ceiling.

Better shape:

```ts
if (
  wavesStarted > 0 &&
  stepMaxDurationMs - elapsedMs <= launchTimeoutMs + safetyBufferMs
) {
  unprocessedGroups.push(...remainingGroups)
  break
}
```

Always allow the first wave so a tightly configured step can still make
progress. After that, defer the remaining groups into the workflow's next
durable process step whenever the projected next launch no longer fits inside
the step budget.

Return the deferred work explicitly at the same granularity where the loop
stopped. For outer group waves, return `unprocessedGroups`. For a target loop
inside one large group, return the same group identity with its `targets` sliced
to the unprocessed language targets. That lets the parent workflow continue in
a fresh durable step without losing ordering, skip semantics, or operator
visibility.

Make sure upstream batching does not erase the loop you intend to guard. A
target-bounded batch can still preserve group chunks:

```ts
const targets = group.targets.slice(
  targetIndex,
  targetIndex + remainingBatchCapacity,
)

current.push({
  ...group,
  targets,
})
```

Avoid changing every target into `{ ...group, targets: [target] }` unless the
inner group loop is intentionally no longer part of the production design.

## Why This Matters

Payload bounding and runtime bounding solve different failure modes. Slicing a
list before a step protects the event log from oversized inputs and outputs; it
does not stop the JavaScript running inside that step from occupying the
Graphile worker past its task boundary.

Once a step crosses that boundary, retry and replay can produce duplicate
`step_started` events. The parent workflow then fails with an unconsumed event
even if the external provider work eventually succeeds. That is especially bad
for embedding backfills because partial success can mutate production search
state while the durable parent run is no longer trustworthy.

Projected runtime guards keep each process step short enough that a resume can
continue from storage health: already-current rows skip, legacy or incomplete
rows launch, and unfinished groups move into a fresh durable step instead of
stretching the current one.

## When to Apply

- A useworkflow step loops over work waves and each wave can wait on an HTTP
  timeout, provider timeout, database lock, or external job boundary.
- The step already has a configured max duration, but checks it only after work
  has been attempted.
- Production logs show duplicate `step_started`, unconsumed event-log entries,
  Graphile task-boundary failures, or a step duration near 300 seconds.
- Operators need to resume a broad backfill without replaying healthy rows or
  redefining a scoped retry as the full all-language run.

## Examples

The transcript embedding process step now tracks how many launch waves have
started. Before each later wave, it compares the remaining step budget against
the Mastra launch timeout plus a safety buffer. If the next wave does not fit,
the remaining groups are returned as deferred work:

```ts
if (
  shouldDeferNextTranscriptEmbeddingLaunch({
    launchesStarted: wavesStarted,
    elapsedMs: Date.now() - batchStartedAt,
    stepMaxDurationMs: safeStepMaxDurationMs,
    launchTimeoutMs,
  })
) {
  unprocessedGroups.push(...groups.slice(i))
  break
}
```

The same check also belongs inside a group's target loop when that loop can
launch Mastra target-by-target:

```ts
for (const [targetIndex, target] of group.targets.entries()) {
  if (
    shouldDeferNextTranscriptEmbeddingLaunch({
      launchesStarted: targetsStarted,
      elapsedMs: Date.now() - batchStartedAt,
      stepMaxDurationMs,
      launchTimeoutMs,
    })
  ) {
    return {
      outcomes,
      pendingConfirmations,
      unprocessedGroup: {
        ...group,
        targets: group.targets.slice(targetIndex),
      },
    }
  }

  targetsStarted += 1
  await launchTarget(target)
}
```

Regression coverage should include both sides of the boundary:

- first wave still runs even when the configured step budget is tight
- later waves defer when `remainingBudget <= launchTimeout + safetyBuffer`
- deferred groups are returned as `unprocessedGroups`
- remaining language targets inside a large group are returned as a sliced
  `unprocessedGroup`
- target-limited production batching preserves multi-target group chunks rather
  than singletonizing every target
- pending ingest confirmations survive when the processed target is followed by
  a sliced remainder group
- deferral branches emit structured, scrubbed logs with processed and remaining
  counts plus budget fields so operators can prove the path is active
- the resume guard still skips only already-healthy enriched rows

## Related

- [Transcript embedding backfills need cancellable resume batches](transcript-embedding-backfill-cancel-and-resume-operations.md)
- [Bound durable workflow step payloads before persistence](bound-durable-workflow-step-payloads-before-persistence.md)
- [useworkflow group fanout must run inside one durable step](../runtime-errors/useworkflow-nested-group-step-event-log-corruption.md)
- [Mastra transcript launch network error diagnostics](../runtime-errors/mastra-transcript-launch-network-error-diagnostics.md)
