# Watch exposure index replacement and reconciliation

## Production result

Root ran the reviewed PR #2516 operator from the deployed Admin worker at
`da6cc006b7c7c759653d170c33d108f3c0b48eeb`, after both HTTP and worker revisions,
health, target, source, capacity, WAL and lock checks passed. Concurrent creation
finished September 30 at 04:35:54 UTC. The old index remained through a separate
observation and review; a freshly admitted concurrent drop finished at 04:47:40.
Neither operation changed rows, UUID uniqueness, served authority or expiry.
Both one-shot attempts are consumed and must never be replayed.

| Measurement                                |          Bytes |
| ------------------------------------------ | -------------: |
| Wide lookup index immediately before drop  |    183,091,200 |
| Six-key replacement at the same checkpoint |     64,405,504 |
| Matched index allocation difference        |    118,685,696 |
| Relation allocation before create          |    665,690,112 |
| Relation allocation after drop             |    551,256,064 |
| Filesystem availability at 04:34:59 UTC    | 10,978,148,352 |
| Filesystem availability at 04:48:07 UTC    | 11,084,873,728 |

The replacement index was 64.8% smaller. Relation allocation fell 114,434,048
bytes, and directly measured filesystem availability increased 106,725,376
bytes across the build/observation/drop interval with ongoing writes. These
overlapping measures must not be added together. The filesystem delta includes
other database activity and is not an isolated DDL attribution. WAL files were
201,326,592 bytes in the bounded before/after statistics. This does not establish
a stable monthly database-growth forecast.

## Read and operational evidence

The immediate post-drop read-only sample used the narrow index for an actual
eight-filter plus policy hit (0.034 ms), a six-key hit (0.014 ms), and a
window-plus-kind hit (0.035 ms). Each explained row count matched its bounded
count query. UUID and primary-index definitions were exact; the separate
served, expiry, cohort and aggregate indexes remained valid. The sample comprised
at most 20 existing rows, with no raw identities or values in the receipts.
These are individual query timings, not population latency percentiles.

Neither the physical sample nor a separate recent sample contained a natural
18-event sibling window. The independently reviewed old-index-absent native
fixture covered that case, exact hits and concurrent reads/writes at 1.5 million
rows. Before the drop, live plans preferred the wide index. Root accepted the
remaining counterfactual production-latency risk using the exact prefix-compatible
catalog, native proof, bounded real-hit evidence and fresh operational admission.
No forced planner settings, catalog changes or discretionary `ANALYZE` were used.

Both services remained healthy. Exposure insert/update counters advanced while
the delete counter remained 17, with zero measured lock waiters. Small changing
15-minute recommendation samples rose from p95 280.2 ms to 480.4 ms before the
drop (maximum 536 ms); this is recorded without attributing the change to the
index operation. Indexed logs for 04:30–04:37 returned four GraphQL HTTP 2xx
entries and no matching pool-slow/rejection entries. Indexed sampling is
incomplete, and HTTP 200 alone does not prove GraphQL operation success.

The first full post-drop 15-minute sample contained 62 requests, p95 309.95 ms,
maximum 524 ms and zero unexpected result types. Its 531 bounded recent runs
were compact with zero legacy children. At 05:03 UTC, exposure writes continued,
the delete counter stayed 17, lock waiters were zero and WAL allocation remained
201,326,592 bytes. At 05:04 both actual Admin roles still matched `da6cc006` and
returned healthy status; filesystem availability was 11,053,514,752 bytes.
These small changing samples support continued observation, not a causal
latency or steady-state growth claim.

## Forward-only reconciliation

Migration `0121_watch_exposure_narrow_index_reconciliation` aligns Prisma with
the physically verified result. A populated database must already contain the
exact valid, ready, live, ordinary six-key index and no wide index. That branch
does no DDL. A 250 ms bounded `SHARE UPDATE EXCLUSIVE` lock stabilizes the catalog
while permitting ordinary reads and writes. Partial or unexpected states fail
closed instead of triggering an ordinary build over live data.

Only an empty fresh database with the exact original wide index takes the DDL
branch. It acquires a bounded exclusive lock, rechecks emptiness, creates the
narrow index and removes the wide one in one transaction. The statement bound is
10 seconds; errors roll back. Historical migration 0103 remains unchanged.

Native tests exercise real `prisma migrate deploy` from zero and against a
populated, already-online checkpoint. They prove unchanged rows, expiry,
replacement relfilenode and bytes, compatibility with an open ordinary writer,
bounded lock failure, and rejection of old-only populated, both-index, missing,
INCLUDE, partial and invalid candidate states. The Prisma schema changes only
this mapped index. No API, application query or retention setting changes.

## Remaining verification

The normal PR-to-main deployment still must apply 0121 and converge both Admin
roles. Root will verify the durable migration row, exact narrow-only catalog,
serving, locks, WAL and filesystem availability after deployment. Compatible
prior images remain available; image rollback cannot recreate the removed
wide index. A performance rollback would require a separately reviewed
concurrent rebuild. Stop further storage mutations if serving regresses.

The legacy trace relation remains 16,431,259,648 bytes allocated, separately
awaiting its protected cleanup and exact-empty reclamation. Feat-554, feat-555,
feat-574 and feat-575 remain in progress. Aggregate-only production receipts:
`/home/nisal/Documents/Codex/2026-09-28/recommendation-traffic-isolation/outputs/heartbeats/20260930T0432-exposure-online-index/`.
