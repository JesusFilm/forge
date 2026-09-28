# Prepare empty legacy recommendation stage reclamation

The reviewed SQL asset is
`apps/admin/src/services/recommendations/sql/reclaim-empty-legacy-stage-relation.sql`.
It is inactive preparation: there is no numbered Prisma migration, runtime
import, package command, schedule or deploy hook. This document supplies no
manual production execution shortcut. A later reviewed PR must promote the
exact tested SQL into the then-next numbered migration through the normal
PR-to-main release path.

The operation preserves the stage table, unique stage constraint/index, expiry
index, Prisma model, mixed-format reader and legacy/compact writer compatibility.
It changes no ranking, evidence lifetime or privacy deletion policy. It never
uses `CASCADE`, drops the reader or retires an old writer.

## Future production entry gates

Keep feat-554 and feat-555 open until their actual production gates pass:

1. Prove sufficient live capacity through the overlap and release, and the first
   two loaded daily retention cycles, including descendant deletion, actual
   wrapper elapsed time, throughput, catch-up, failures, WAL and oldest-expired
   age. A successful zero-root purge is not loaded capacity proof.
2. Complete authenticated Admin full-detail smoke; database parity is not UI proof.
3. Verify all active Admin HTTP and worker process revisions, effective compact
   flags, health and old-process drain. Record a rollback image that reads both
   compact and legacy traces. Disabling compact writes must not select a reader
   that cannot read already stored compact traces.
4. Recompute the last legacy write and greatest original expiry from current
   data, and prove actual purge has left no retained legacy request/run or stage
   evidence. The observed October 26, 23:24:43.126 UTC expiry is an earliest
   horizon, not execution permission. Any resumed legacy writing moves it.
5. Re-review the exact relation, triggers, constraints, dependencies, lock plan
   and tested SQL against the then-current schema before promoting the migration.

Use bounded read-only sessions and aggregate projections. These queries expose
no request or run identifiers:

```sql
BEGIN READ ONLY;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
SELECT max(c.created_at) AS last_legacy_run_created_at,
       max(r.expires_at) AS latest_legacy_request_expiry,
       count(*) AS legacy_runs,
       count(*) FILTER (WHERE r.expires_at > now()) AS unexpired_legacy_runs
FROM public.recommendation_candidate_run c
JOIN public.recommendation_request r ON r.id = c.request_id
WHERE c.trace_format_version IS NULL AND c.trace_payload IS NULL;
SELECT EXISTS (
  SELECT 1 FROM public.recommendation_candidate_stage_evidence LIMIT 1
) AS legacy_stage_evidence_remains;
SELECT pg_total_relation_size('public.recommendation_candidate_stage_evidence')
         AS stage_total_bytes,
       pg_relation_size('public.recommendation_candidate_stage_evidence')
         AS stage_heap_bytes,
       pg_indexes_size('public.recommendation_candidate_stage_evidence')
         AS stage_index_bytes,
       pg_database_size(current_database()) AS database_bytes;
COMMIT;
```

A last-run timestamp is not a last-stage timestamp. Reconcile saved writer
history and stage creation/expiry observations from the storage investigation's
bounded probes; after deletion, current tables cannot reconstruct their prior
horizon. These aggregate scans can exceed the budget on a large relation: stop
and investigate the plan rather than remove budgets. A predeployment empty
result is preliminary; estimates from `pg_stat_*` never replace exact existence.

## Transaction and failure behavior

The asset starts one transaction, sets a one-second lock timeout and ten-second
statement timeout, and explicitly obtains `ACCESS EXCLUSIVE` before checking
exact emptiness. The assertion and restrictive truncate share that lock and
transaction. Nonempty evidence raises `P0001`; no row is deleted. A new inbound
foreign key makes restrictive truncate fail rather than cascade into another
table. No evidence is removed to make a refusal pass.

The lock also conflicts with ordinary readers. A lock timeout (`55P03`) or
statement timeout (`57014`) aborts the transaction. Roll it back, investigate
writers/readers and fresh fleet state, then arrange a separately reviewed retry.
Do not automatically retry, weaken budgets or terminate blockers. Each statement
has a budget; this is not a measured ten-second end-to-end release guarantee.
A late legacy write waits behind the lock, then can insert after commit because
writer compatibility remains. Therefore fleet convergence and horizon checks
are essential even though the in-transaction check is race-safe.

PostgreSQL truncate is transactional, but is not MVCC-safe for old snapshots.
Coordinate this brief exclusive-lock release with serving observations; the
local proof does not establish production reader pause or scan latency on the
historical multi-GB relation. The table is unpartitioned in the tested schema;
re-review inheritance/partitioning before promotion rather than assuming that
property forever.

## Measure the result and preserve rollback compatibility

Save fresh relation totals including indexes and TOAST, database bytes, WAL,
filesystem available bytes, volume accounting and timestamps before and after
the committed migration. Record actual process revisions and serving health.
A relation-byte decrease in a disposable fixture demonstrates file reclamation
behavior; it does not forecast production GB, filesystem margin, concurrent WAL
costs or sustained capacity. Do not count the earlier duplicate-index drop again.

Verify compact complete detail, served items, outcomes, evaluation, access audit
and original expiry remain unchanged. Check ongoing retention and ordinary
serving. Keep the mixed-format reader and rollback floor after success; a
reader-only old image is unsafe if it predates compact support. A failed
transaction rolls back the truncate. A committed empty-table reclamation has no
retained evidence to restore; do not manufacture expired rows or reverse privacy
deletion as application rollback.

## Disposable proof

`legacy-stage-reclamation.db.test.ts` executes the exact asset against all current
Prisma migrations on a dedicated loopback database. It refuses non-loopback
hosts and database names outside `forge_legacy_reclamation_*`, rejects all URL
query parameters and fragments (including destination overrides), requires
`RECOMMENDATION_DB_TEST=1`, and refuses pre-existing recommendation requests.
Run it serially, only on an explicitly owned disposable database; the proof
truncates the whole stage relation and must not share data with other tests.

The suite covers retained-row refusal, conflicting reader timeout and retry,
writers before and after exclusive-lock acquisition, expired-root cascade and
measured relation reclamation, compact full-reader/outcome/evaluation/expiry
preservation, compact retention afterward, legacy issuance afterward, rollback
following truncate, and a new inbound foreign key refusing safely.

No SQL asset is deployed by these tests. Production horizon, loaded retention,
fleet, capacity, authenticated UI and final filesystem recovery remain separate
gates in feat-554/555.
