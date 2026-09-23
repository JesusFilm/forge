---
title: "Test and reduce authored block dub lookup fanout"
status: active
type: fix
---

# Watch block dub pool fanout

Continue in-progress feat-496 from fresh main `5a30f5ddc` in the task-owned
worktree on `codex/watch-block-dub-batch-20260923-q7n`. PR #2399's timing
instrumentation is merged and its automatic deployment is pending.

## Evidence and hypothesis

Retained production trace `6ab3333c000000006c62ce4aacd4fd55`, settings span
`7604331360358271055`, contains 62 `VideoDub.findFirst` calls in one normal
`GetWatchSettings` operation at 02:02:38 UTC. The same ingestion second has
60 slow pool acquisitions, maximum queue 102 and maximum acquisition 102 ms.
The settings operation completed in 183 ms; it is not the historical timeout.

Four authored block resolvers in `apps/admin/src/graphql/types/blocks.ts`
call `selectedBlockVideoDubArgs` and then `videoDub.findFirst` directly for
each item. These sibling calls share the ten-connection main pool. Prediction:
concurrent settings-shaped bursts reproduce a queue in an isolated real
PostgreSQL fixture; batching exact video/language pairs reduces queries and
queueing for a concurrent small read without changing selected dubs.

This is a test of a concrete competing workload. The historical selection
503 and delivery HTTP 200 timeout fallback remain unassigned unless matched
production evidence establishes the connection. Do not label a synthetic
deadline failure a reproduction of the historical incident.

## Execution gates

1. Capture current resolver fanout with a failing regression and reproduce
   the queue using synthetic catalog rows in an owned PostgreSQL container.
   Use the production ten-connection pool and recorded 62-call shape; report
   workload/concurrency assumptions and both isolated and competing-read timing.
2. If the prediction holds, batch authored exact video/language lookups using
   request-local loaders. Preserve Pothos selection, missing identities, nulls,
   publication/deletion/playability filters, duration DESC null ordering and
   id tie-break, original errors, and current authorization. Bound batches.
3. Compare before/after results against the existing scalar query on real
   PostgreSQL, including different languages, multiple editions, null duration,
   missing/deleted/unpublished/unplayable rows, nested selections and duplicate
   keys. Verify request isolation and withdrawal between selection/hydration.
4. Review sequentially with Compound Engineering; regenerate/check schema and
   consumer introspection, run scoped/full Admin and CI-sensitive gates, then
   incorporate fresh main before normal PR merge. No UI, flag, content, deadline,
   retry, pool-size or production database mutation.
5. Verify automatic deployed revisions and natural query shape/queue behavior;
   finish PR #2399 source-timing capture and temporary-observer cleanup. Report
   HTTP and semantic failures separately, compound the evidence and preserve
   feat-496's unresolved causal/recovery gates.
