# Recommendation stage expiry index assessment

## Decision and boundary

Prepare a data-preserving forward migration to remove the nonunique
`recommendation_candidate_stage_expiry_idx` on `(expires_at, id)`.
No production change has been made by this unit. Migration `0118` is provisional
until integration checks the current next number. Keep `feat-574` in progress
until release and observed production recovery.

The September 29 20:29 UTC aggregate production preflight measured the valid
index at **1,961,811,968 bytes**. It backs zero constraints and has zero catalog
dependents. Its six recorded scans and 1,290,399 tuples read are unchanged since
the September 28 assessment; the stats reset interval is unknown. It is neither
unused nor an exact duplicate. A scan may have been valuable. The root owner
found no stored function or view that references the stage table; `pg_cron` and
`pg_stat_statements` were unavailable, so external ad hoc queries remain
unproven. That uncertainty must be reviewed at release, not hidden by an
`idx_scan` label.

## Active access paths

Repository-wide search found no standalone stage-expiry purge. Normal retention
selects expired `recommendation_request` roots, counts stages through the
candidate run's `request_id`, then deletes roots with foreign-key cascades.
Legacy conversion selects and deletes stages by `run_id`. Admin detail reads
the one candidate run and filters its stages by `run_id` and `expires_at`.
The retained unique `(run_id, stage, ordinal)` index is the run-leading access
path and enforces identity. The stage primary key, run foreign key, expiry
column, equality-to-root-expiry trigger, legacy and compact reader paths remain.

On the isolated local PostgreSQL database, 2,000 requests/runs with 64 stages
each (128,000 rows) were inserted using the current schema and native expiry
trigger. Before and after the migration, `EXPLAIN (ANALYZE, BUFFERS)` used
`recommendation_candidate_stage_ordinal_key` for the run-scoped detail filter
and stage count. The count also used
`recommendation_candidate_run_request_id_key`. A root-delete transaction
reached all 64 stages via the run foreign key and rolled back without data loss.
The native migration fixture additionally verified the committed cascade after
the index was removed.

## Quiet-window physical and latency receipt

The owner granted a quiet shared-PostgreSQL window. Before the measured drop,
`pg_stat_activity` showed zero non-idle sessions in the task databases. Prisma
`migrate deploy` applied the exact `0118` SQL in the task-owned
`forge_storage_expiry` database. The stage relation allocation fell from
50,561,024 to 44,171,264 bytes: **6,389,760 bytes**, exactly the measured
local expiry-index allocation. All 128,000 stage rows remained. WAL advanced
75,920 bytes over the migration interval, including Prisma migration bookkeeping.
This local WAL observation does not forecast production WAL or filesystem margin.

| Warmed local query, 200 client samples | Before p50 / p95 |  After p50 / p95 |
| -------------------------------------- | ---------------: | ---------------: |
| Run-scoped stage detail, 64 rows       | 0.804 / 2.015 ms | 0.775 / 1.226 ms |
| Root-scoped stage count, 64 rows       | 0.638 / 1.150 ms | 0.585 / 0.701 ms |

The plans were unchanged and no local regression was observed. These sub-ms
differences are not a production performance claim. An `EXPLAIN ANALYZE` root
delete of one loaded request took 20.0 ms before and 16.2 ms after; cache and
other FK-trigger work dominate these single samples.

## Migration and rollback

The migration uses an ordinary transactional `DROP INDEX` with a two-second
lock timeout and a 15-second statement timeout. The native two-connection test
held `ACCESS SHARE` on the stage table: migration failed with `55P03` after its
lock budget and preserved both index and stage row. Releasing the blocker and
rerunning the same SQL removed the index, left the row intact, and preserved
request-root cascade. A committed drop is application-rollback-compatible
because the schema and reader retain the expiry field; recreating a roughly
2 GB index would itself require a separate reviewed, bounded rollout and is
not an automatic rollback step. A failed migration must be resolved through
normal Prisma migration recovery before retrying; do not force a long lock.
The 6.39 MB fixture does not establish the actual lock hold or file-release
time for the production 1.96 GB index; the timeouts bound this attempt's lock
wait and statement, not total PR deployment duration.

Production release still requires fresh catalog/query-consumer review, exact
migration numbering, normal PR-to-main deployment, live lock/health and volume
monitoring, actual relation/filesystem bytes afterward, and protection of the
first loaded retention cycles. This migration deletes no stage evidence and
does not change the 29-day retention contract. This 1.96 GB is part of the
previously measured 18.39 GB stage-relation total, not additional to it; subsequent
whole-relation reclamation must use the remaining measured allocation.
