# Recommendation trace storage remediation

This runbook covers the code in migrations 0100–0102 and the version 1 compact
candidate trace. It is not an instruction to run SQL against production outside
the normal PR-to-main Admin deployment. The September 28 investigation measured
a 2.36 GB duplicate index and a 20.60 GB candidate-stage relation. The new
format retains every stage observation for the existing 29-day request lifetime.

## Release order and rollback floor

1. Migration 0100 adds nullable `recommendation_candidate_run.trace_format_version`
   and `trace_payload` and a validating check. Existing runs remain `(NULL,
NULL)` and keep their existing stage rows. Migration 0101 validates the check
   in a separate transaction after 0100's add-column lock has been released.
2. Migration 0102 drops **only** the nonunique
   `recommendation_candidate_stage_run_stage_idx`. The unique constraint and its
   `recommendation_candidate_stage_ordinal_key` index remain. Its `(run_id,
stage, ordinal)` access path still serves legacy detail reads and uniqueness.
3. Deploy the Admin reader with both formats supported, while the compact writer
   is disabled. Verify bounded live legacy stage parity and the actual full
   legacy/mixed/compact detail reader, including empty stages, in the real-PostgreSQL
   integration suite. Also exercise the production detail UI when an authorized
   session is available; otherwise record that verification limit explicitly.
   Never fabricate an access-audit identity or bypass authentication. Enable
   compact writes only after every Admin HTTP and workflow replica runs that
   reader. Old processes must drain; an environment variable change alone is
   not a fleet barrier. The operator guide in
   `apps/admin/docs/recommendation-trace-storage.md` records this release gate.
4. Once compact writes begin, the immediately prior **dual-reader** release is
   the application rollback floor. Rolling back to today's row-only reader would
   hide new trace detail, although it would not delete it. If compact writing
   must stop, disable its flag and retain the dual reader until compact-written
   requests reach 29-day expiry. Do not roll the database schema backward.

Version 1 uses one JSONB payload on the run: `{ "stages": [...] }`. Each array
entry keeps its original ID, creation time, stage, ordinal, candidate and media
identifiers, optional generator/rank/scores/position, reason codes, and full
source evidence. The request root already cascades to its candidate run; no
second expiry clock or independent cleanup path is introduced. Null format and
payload mean legacy stage rows. The database requires both fields together,
version 1, at most 448 observations, the former stage/ordinal and value bounds,
and unique stage/ordinal pairs. Empty `stages` is valid.

## Index lock and failure recovery

PostgreSQL's ordinary `DROP INDEX` acquires `ACCESS EXCLUSIVE` on the 20-million
row stage table, blocking reads and writes until commit. Migration 0102 contains
only the drop and sets `lock_timeout = '2s'` so it fails instead of waiting
behind a long transaction. It can still briefly queue other work. A contended
attempt leaves the duplicate index present; the isolated PostgreSQL test holds
an `ACCESS SHARE` lock, verifies error `55P03`, rolls back, then retries the
exact migration successfully after releasing the blocker. The predeploy job
will fail closed on a real lock timeout. Diagnose blockers and use the normal
forward migration recovery procedure; do not mark the migration applied when
the index remains. `DROP INDEX CONCURRENTLY` would avoid this table lock, but
PostgreSQL prohibits it in the transaction used by this Prisma migration path.

The existing predeploy recovery helper does not automatically resolve 0102.
After an operator confirms that the attempt failed with `55P03`, its transaction
rolled back, and the duplicate index remains valid, mark that **failed attempt**
rolled back using Prisma's normal recovery command in the selected environment:

```bash
pnpm --filter @forge/admin exec prisma migrate resolve --rolled-back 0102_recommendation_candidate_stage_duplicate_index_drop
```

Then retry through the normal deployment flow after the blocker clears. Do not
run this command automatically for an unknown error, mark the migration applied
without catalog verification, or recreate the large redundant index as an
application rollback step.

The existing unique constraint remains the invariant after the drop. Check the
deployed catalog and migration status after a normal deploy:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'recommendation_candidate_stage_evidence'
  AND indexname IN (
    'recommendation_candidate_stage_run_stage_idx',
    'recommendation_candidate_stage_ordinal_key'
  );

SELECT DISTINCT ON (migration_name)
  migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name IN (
  '0100_recommendation_candidate_compact_trace',
  '0101_recommendation_candidate_compact_trace_validate',
  '0102_recommendation_candidate_stage_duplicate_index_drop'
)
ORDER BY migration_name, started_at DESC;
```

The first query must show only `recommendation_candidate_stage_ordinal_key`;
each migration's latest attempt must have a nonnull `finished_at` and null
`rolled_back_at`. Earlier rolled-back attempts remain in Prisma's history.
Also verify `pg_constraint.convalidated` for
`recommendation_candidate_trace_format_check`, recent trace detail parity, and
request-root cascade in a disposable database. Do not run destructive proof
queries against production.

## Storage expectations and reproducible proof

Dropping the duplicate index can return its own relation file bytes to the
filesystem once PostgreSQL commits the drop; the investigation measured 2.358
GB for that index at its snapshot. Switching writes does not immediately remove
old stage rows. They remain intact until their request roots expire after 29
days. Ordinary cascade deletion and vacuum generally make table pages reusable
inside PostgreSQL rather than returning the table's allocated file size to the
filesystem. Do not use an unplanned `VACUUM FULL` on a nearly full live volume.

The opt-in synthetic benchmark is
`apps/admin/scripts/benchmark-recommendation-trace-storage.mjs`. It requires an
isolated PostgreSQL 18 database with all Admin migrations applied, a loopback
`DATABASE_URL`, an exact disposable database-name assertion, and
`RECOMMENDATION_STORAGE_BENCHMARK=1`. It creates and drops only its private
schema. Its cohorts have 82, 113, 195, and 323 stage observations per run,
matching the observed full-period, recent, hybrid, and curated-fallback scales.
For each cohort, it writes the requested number of runs **per variant** and
alternates legacy and compact inserts in ABBA order. Source evidence varies
deterministically between 1, 3, and 16 objects and carries varying scores and
longer provenance text; repeated evidence across stages is retained. The
legacy fixture retains the unique index but omits the redundant one, so measured
savings are attributable to the trace representation rather than the easy
index removal. It reports committed-write latency including JSONB validation,
total relation bytes including table, TOAST and indexes, detail-query plans,
and physical size before/after cascade deletion, vacuum, and equal-count
replacement writes. It asserts every persisted legacy and compact stage field
against its original synthetic input and verifies run and stage counts at each
measurement boundary.
It uses generated data only; no production payload or viewer identifier is
copied.

```bash
source /path/to/isolated-admin-db.env
CI=1 RECOMMENDATION_STORAGE_BENCHMARK=1 \
RECOMMENDATION_STORAGE_BENCHMARK_DATABASE=isolated_admin_benchmark \
RECOMMENDATION_STORAGE_BENCHMARK_RUNS=100 \
RECOMMENDATION_STORAGE_BENCHMARK_OUTPUT=../../docs/reports/2026-09-28-production-db-storage/synthetic-storage-benchmark.json \
pnpm --filter @forge/admin exec tsx scripts/benchmark-recommendation-trace-storage.mjs
```

Run from the repository root. `CI=1` bypasses unrelated Admin startup credential
validation for this local tool; the benchmark still explicitly enforces every
database safety guard. Its settings are read through `src/config/env.ts`.

Create the environment file locally with `DATABASE_URL` for a disposable
loopback-hosted PostgreSQL 18 database with pgvector and all Admin migrations
applied. Keep credentials out of command output and the repository. Set the
benchmark database-name assertion to that database's exact name.

The synthetic sample cannot predict production bytes exactly: real source
evidence length, generator mix, TOAST compression, relation free space, cache,
and concurrent traffic differ. Compare post-deploy read-only relation sizes,
disk-growth slope, trace write timing, and retention throughput against the
saved investigation probes. A successful compact representation reduces new
writes; it does not substitute for immediate disk headroom or a tested purge
rate above incoming volume.
