# Recommendation trace storage release

This guide is for the Admin HTTP service and its dedicated Postgres World worker.
The compact writer preserves every candidate-stage observation, including source
evidence, for the request's existing 29-day lifetime. It changes storage shape,
not sampling, retention, or the authorized request-detail contract. The detailed
migration and lock recovery procedure is in
`docs/reports/2026-09-28-production-db-storage/storage-remediation-runbook.md`.

## Reader-first activation

1. Deploy the dual-format Admin reader through a reviewed PR merged to `main`.
   `apps/admin/railway.toml` serves HTTP with
   `WORKFLOW_RUNNER_ENABLED=false`; `apps/admin/railway.worker.toml` runs durable
   workflows with `WORKFLOW_RUNNER_ENABLED=true`. Both use the same Admin code,
   have separate Railway deployments, and run `db:migrate:deploy` before start.
   Confirm each service's Config-as-code Path points to its respective file.
2. Keep `RECOMMENDATION_CANDIDATE_TRACE_FORMAT=legacy` (or unset) on both
   services. Confirm migrations 0100–0102 finished, the compact check is
   validated, the duplicate nonunique index is absent, and the unique
   `recommendation_candidate_stage_ordinal_key` remains. Verify bounded legacy
   stage parity in production and the full legacy/mixed/compact detail contract
   in the real-PostgreSQL integration suite. When an authorized Admin session is
   available, also verify live detail, including empty-stage runs, through the
   normal UI. Record an unavailable UI session as an outstanding verification
   limit; do not fabricate an audit actor or bypass authentication to test it.
3. Inventory **every active HTTP replica and workflow process**. Confirm the
   exact dual-reader revision, successful health checks, effective legacy flag,
   and drained older processes on both services. A successful deployment or a
   changed Railway variable alone does not establish fleet convergence. Retain
   a deployable dual-reader image for each role as the rollback floor.
4. Check current filesystem free bytes, Railway volume trend, candidate run and
   stage relation sizes, WAL, write/error latency, and retention backlog against
   `docs/reports/2026-09-28-production-db-storage/probes.sql`. Size headroom for
   the full 29-day coexistence of old stage rows and new compact payloads. Do
   not infer production savings from the synthetic benchmark alone.
5. Stage `RECOMMENDATION_CANDIDATE_TRACE_FORMAT=compact` for **both** Railway
   services with `--skip-deploys` only after steps 1–4 pass. Activate through a
   reviewed Admin-scoped PR merged to `main` and its normal autodeploy; do not
   publish worktree code with `railway up` or force a Railway redeploy. Any
   intervening deployment after staging may activate one role early, so watch
   both service inventories. Confirm the new active revision and effective flag
   on both services before declaring activation complete.

   ```bash
   railway variable set --project <forge-project-id> --environment production \
     --service <admin-http-service-id> --skip-deploys \
     RECOMMENDATION_CANDIDATE_TRACE_FORMAT=compact
   railway variable set --project <forge-project-id> --environment production \
     --service <admin-worker-service-id> --skip-deploys \
     RECOMMENDATION_CANDIDATE_TRACE_FORMAT=compact
   ```

   Read back only this nonsecret key for each service before and after the
   autodeploy. A staged variable is not proof of the process's effective value.

Record deployment IDs, revisions, operator, UTC activation time, last legacy
write, migration/catalog results, disk headroom, and rollback trigger in
`docs/reports/2026-09-28-production-db-storage/` under feat-554. Do not record
request IDs, viewer identifiers, credentials, or raw trace evidence. The latest
legacy timestamp becomes a retirement horizon only after every legacy writer
has drained; any resumed legacy writing moves that horizon forward.

## Verify and watch

- In a read-only connection with `default_transaction_read_only=on`, a 10-second
  statement timeout, and a 1-second lock timeout, compare each of seven stage
  counters with stored observations for a bounded recent sample of compact and
  legacy runs. Compact runs must have version 1, a payload with complete stages,
  and zero stage-table rows; legacy runs must have null version/payload and
  matching stage rows. Check `evidence_complete` and include zero-stage runs.
- The authorized `/dashboard/recommendations/[requestId]` page exercises the
  actual mixed-format reader and outcomes/evaluation panels. It writes the
  required trace-access audit row. Use it only with
  `read:recommendation-traces` permission, and retain aggregate parity and
  success status rather than identifiers, URLs, screenshots, or raw evidence.
- Watch request errors, candidate write latency, JSONB validation/TOAST cost,
  disk growth and free bytes, WAL, lock waits, and relation sizes. Through the
  first nonempty request purge and the next daily cycle, compare new writes
  with `recommendation_retention_run.roots_deleted`, descendant `row_counts`,
  batch duration, skipped/failed runs, and oldest expired age. The bounded
  workflow may continue catch-up after full batches; verify actual production
  throughput rather than assuming it.

If compact writes must stop, return **both** service flags to `legacy` and
activate that change through the normal PR-to-main deployment process. Verify
both effective flags and the absence of new compact runs. Keep a dual-reader
image deployed until all compact-written requests have expired and been purged;
the older row-only reader would hide compact detail. Do not roll back the
database schema, recreate the redundant index, shorten the 29-day retention,
sample detail, or rewrite a nearly full production table. Ordinary purge and
vacuum usually make table pages reusable within PostgreSQL rather than shrink
the allocated file; physical legacy-storage reclamation belongs to feat-555.
