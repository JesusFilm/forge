# Bound standalone playback cleanup before request retention

## Evidence and scope

The October 3 normal production retention cycle exhausted its unchanged five-second whole-run deadline in the request-free playback episode phase. Across 125 scheduled wrappers, each attempt committed 24–56 standalone episode deletions and no expired request roots. The durable and workflow ledgers show transaction timeout/closed errors; they do not establish a profile-tail regression. At the bounded read, 10,416 expired roots and 18,590 expired standalone episodes remained. This is aggregate operational evidence, not an authorization to run a manual purge.

## Change

- Select a small fixed page of expired request-free episodes before request roots, regardless of the root batch size. Keep each episode's existing transaction, full dependency admission/recheck, and atomic count/delete. Do not combine independently safe closures into a larger one that might cross the existing 50,000-dependency guard. Keep the current lock order, five-second deadline, and 29-day expiry.
- Ensure a full standalone page requests continuation even when no request root is overdue. Preserve durable counts from prior committed phases if a later phase fails.
- Add an owned loopback PostgreSQL regression with a loaded standalone backlog and expired request roots, plus facts/outcomes and live/request-owned controls. Assert first-pass root progress, page continuation, cascading counts, and eventual cleanup. Exercise the existing source/graph closure and per-episode rollback/durable-prior-count behavior.

## Validation and release

The owned PostgreSQL comparison selected 100 expired standalone episodes and
12 expired request roots, with real facts, outcomes, source lineage, graph
triggers and a local-only 40 ms per-row DELETE cost. Main's uncapped phase
failed after 5.22 seconds with a closed Prisma transaction and zero request
roots. The cap-only change completed its first pass in 1.13 seconds, deleting
ten episodes and all twelve roots; nine later pages removed the remaining
ninety. A separate local failure fixture proves earlier per-episode counts
survive one later rejected deletion, which then retries without double-counting.

The scheduler permits at most eight batches in a 30-second pass and waits
60 seconds between catch-up passes. Ten episodes per batch is a theoretical
ceiling of 80 episodes per minute, not measured production throughput. The
October 3 production sample counted 209 newly **created** standalone episodes
in one hour; that is not the rate at which episodes become expired and cannot
establish a net drain ETA. Actual automatic catch-up and serving-gate recovery
must be observed after release.

Run native PostgreSQL tests with the real schema, focused typecheck, format/lint, and required CI. Record the production incident and implementation limits in feat-554 and a durable solution note. Open a scoped PR for the parent to review/merge through the normal path. Two subsequent normal failure-free loaded daily cycles, actual backlog and capacity evidence, and the independently reviewed evidence closeout are still required to complete feat-554.
