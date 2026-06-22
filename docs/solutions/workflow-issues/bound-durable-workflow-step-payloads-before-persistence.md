---
title: "Bound durable workflow step payloads before persistence"
date: "2026-06-22"
category: workflow-issues
module: apps/admin workflow backfills
problem_type: workflow_issue
component: background_job
severity: high
applies_when:
  - "A useworkflow step receives a growing list of pending work or confirmations"
  - "A durable backfill polls external provider work after the launch request returns"
  - "A resume flow must skip only rows already written by the current embedding generation"
tags:
  - admin
  - useworkflow
  - graphile
  - backfill
  - transcript-embeddings
  - resume
  - step-payloads
  - hotfix
---

# Bound durable workflow step payloads before persistence

## Context

The June 2026 enriched transcript embedding backfill was already split into
target-bounded processing steps, but the confirm-ingest phase still passed the
entire pending confirmation list into one durable step. When enough Mastra
launches timed out at the Admin request boundary, the pending list grew large
and confirm-ingest steps crossed the Graphile worker task boundary. Production
then failed the Workflow run with an unconsumed `step_started` event even
though many individual transcript ingests had succeeded.

The root issue was not AI Gateway availability. The workflow was asking the
durable runtime to persist too much step input/output around a long-running
confirmation boundary.

## Guidance

Treat every `"use step"` argument and return value as a persisted event-log
contract. If a list can grow with corpus size, slice it before the durable step
call.

Bad shape:

```ts
// The step may batch internally, but Workflow still persists the whole list.
const confirmed = await stepConfirmTranscriptEmbeddingIngests(pending)
```

Better shape:

```ts
const { slice, remainder } = splitPendingConfirmations(
  pending,
  confirmationBatchLimit,
)

const confirmed = await stepConfirmTranscriptEmbeddingIngests(slice)
const unresolved = removeConfirmed(slice, confirmed)
pending = [...remainder, ...unresolved]
```

Use the same rule for terminal failure marking. If unresolved pending work
must be converted into failed outcomes, call the failure step with bounded
slices rather than one final all-pending array.

For long confirmation windows, track budget in full queue cycles, not raw step
calls. A queue of 26 pending confirmations with a limit of 25 needs two slices
per poll cycle. A fixed "max polls plus one" budget can fail the tail before it
gets the same number of chances as the head.

Resume guards need the same precision. A row is safe to skip only when it was
written by the current generation and has complete searchable data:

- current `generation_mode`
- accepted model stamp
- expected embedding dimensions
- current embedding provider
- non-empty source provenance
- every chunk has an embedding
- every chunk has non-empty embedded input text

Do not call legacy, stale provider/model, `force`, zero-chunk, or incomplete
rows "healthy" for resume-skip purposes.

## Why This Matters

Batching inside a step does not protect the durable runtime when the step
itself receives the full payload. The event log must still persist that input,
then persist the output. Once the worker crosses its task boundary, retry and
replay can produce duplicate or unconsumed step events, which turns a recoverable
provider wait into a failed parent Workflow run.

Slicing before the step keeps each persisted event bounded. Rotating unresolved
items to the tail gives every target a chance to confirm without starving later
items, while a cycle-based wait budget avoids prematurely failing large queues.

Strict resume predicates protect cost and relevance. The operator can safely
resume from the latest known failed core without rerunning already-current
language rows, and without accidentally skipping stale embeddings that still
need the hotfixed path.

## When to Apply

- A background workflow has a `pending`, `failed`, `unconfirmed`, or
  `toProcess` list that can grow with the production corpus.
- The workflow waits for external systems after launching work, especially
  provider jobs that can complete after the caller times out.
- A broad backfill needs resume semantics that preserve already-current rows
  while retrying legacy or incomplete rows.
- Local tests pass but production useworkflow or Graphile logs show
  `step_started`, unconsumed-event, event-log, or task-boundary failures.

## Test Checklist

- Assert the step receives at most the configured batch size, not just that a
  helper returns the right count.
- Cover a multi-slice final wait before the first sleep.
- Cover queues whose length exceeds exactly one batch.
- Cover resume predicates for stale generation mode, stale model, stale
  provider, missing provider, stale dimensions, missing source kind, empty
  source kind, incomplete chunks, missing embedded input text, and zero chunks.
- Cover the production resume trigger shape: scoped by the latest failed core
  id, no language filter, and `MODEL_UPGRADE` mode.

## Related

- [Transcript embedding backfills need cancellable resume batches](transcript-embedding-backfill-cancel-and-resume-operations.md)
- [useworkflow group fanout must run inside one durable step](../runtime-errors/useworkflow-nested-group-step-event-log-corruption.md)
- [Mastra transcript launch network error diagnostics](../runtime-errors/mastra-transcript-launch-network-error-diagnostics.md)
- [Bounded parallelism pattern for admin per-target useworkflow loops](../best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md)
