# Fortnightly Watch exposure retention

## Decision and scope

The owner requested a 14-day expiry for anonymous Watch exposure measurement
after a production storage warning. Implement this as a narrow exposure policy.
Do not change the shared 29-day recommendation raw-retention constant or other
record lifetimes. Preserve per-item served manifests, exact V2 event binding,
replay detection and the public Watch experience. Retention remains background
work concurrent with serving under the October 19 owner policy.

## Dated baseline and risk

At the October 22, 2026 20:30 UTC read-only checkpoint, the nominal 50,000 MB
PostgreSQL volume was ready. PGDATA had 10,753,601,536 bytes directly free of
48,891,670,528 (78.0% used). It had lost 3,348,373,504 free bytes since
October 18 23:33 UTC. That short interval implies about 12.4 days to full only
if its slope continues; it is not a steady-state forecast. The ordinary
`watch_surface_exposure` relation allocated 7,247,331,328 bytes, including
4,540,989,440 of indexes, and was the largest measured growth source since
October 1. Its approximately 10.8 million live rows had no expired rows at
the October 22 20:33 UTC read. The first persisted expiries begin October 27;
2,303,163 rows expire October 27–31. The legacy stage table remained empty.

The October 22 retention day had genuine failed attempts amid successes and
budget yields. Its monitored types had zero rows beyond the 24-hour
propagation threshold, but the health query omitted Watch exposures. That
zero therefore did not establish exposure expiry capacity. The existing purge
uses at most 100 exposure rows in a shared five-second run. Do not treat the
coming expiry wave as already cleared or infer sustained throughput from a
different mixed workload.

The [bounded local PostgreSQL 18 fixture](../validation/recommendation-exposure-20261023/retention-capacity.json)
used 500,000 exposure rows and seven production indexes. Ten actual-service
attempts each deleted 1,000 expired rows, with a 602.5 ms median; all ten
continued because backlog remained. This supports an independent 1,000-row
exposure page under the unchanged five-second deadline. It does not prove
production throughput with loaded request roots, a clean daily cycle or any
filesystem recovery. Genuine timeout rollback and durable failure reporting
have separate native regressions.

## Staged implementation

1. **Policy and contracts.** Add an exposure-only 14-day constant and use it
   for new served manifests and V1 events. V2 events inherit the served row's
   exact expiry. Keep short-lived manifest authorization separate from raw
   retention. Verify new and retry paths with focused tests.
2. **Cleanup and observability.** Include exposures in overdue health. Use
   native PostgreSQL tests against a loaded cohort to choose an independently
   bounded exposure page. Keep the existing lock, five-second run deadline,
   other phase caps, durable counters and genuine failure reporting. Preserve
   exact `expires_at` ordering and continuation.
3. **Historical cohort.** New-write expiry does not change existing 29-day
   rows. Leave their persisted expiry intact and let the normal bounded job
   drain them, beginning with the observed October 27 expiry cohort. This is a
   deliberate transition: V2 facts inherit served expiry and a timestamp-only
   test cannot reliably distinguish every old and new row. A new marker,
   backfill or bulk deletion would add WAL and dead tuples while ordinary
   deletion would not return most relation files to the filesystem. Record the
   delayed steady-state benefit rather than claiming immediate reclamation.
4. **Reporting.** The authorized Admin exposure view currently accepts a
   trailing 29-day window. Once raw exposure history is shorter, relabel or
   remove that option for exposure-only reports, or explicitly present it as
   partial. Preserve unrelated 29-day request/trace views.
5. **Release and measurement.** Merge only reviewed green PRs to main and
   verify both actual Admin roles, Web separately, the two retention ledgers,
   exposure backlog, serving health, WAL, PGDATA and relation sizes. Distinguish
   fewer live rows and reusable pages from physical filesystem recovery.

## Stop conditions and alternatives

Stop cleanup tuning on lock waits, failed transactions, stale health/capacity
evidence, rising overdue exposure age or insufficient free space. A nominal
volume increase is an owner financial decision and may be needed as a bridge.
Ordinary `DELETE` plus vacuum usually reuses pages without shrinking filesystem
allocation. Expiry partitioning may offer later physical file recovery, but
current independent uniqueness rules make it a separate migration and it is
not part of this rollout.

## Acceptance

The result requires exact new-write expiry and V2 parity, no unexpected legacy
29-day contract change, truthful cleanup/health, a safe disposition of existing
rows, and a report that states observed bytes rather than estimated savings.
Record actual tests, CI, deployment revisions and post-release read-only
receipts before claiming the transition complete. Platform feat-554's separate
two clean loaded daily-cycle gate is not waived by this work.
