# Watch exposure window index online replacement

This is a two-operation, normal-release operator for `watch_surface_exposure`. It changes only the nonunique window lookup index. It keeps every exposure row, `event_id` and primary-key uniqueness, the served partial unique index, cohort/aggregate indexes, and 29-day expiry. The CLI ships **without automatic execution**; Prisma schema and migrations remain unchanged until a later reconciliation PR.

Use only the CLI from a deployed, reviewed Admin image after root-owned target, reader/writer fleet, health, capacity/WAL, lock-waiter and query admission. Never run a local worktree build against production. One operator invocation performs at most one concurrent DDL statement. The code uses one `pg` connection in autocommit, not Prisma `$transaction` or a migration. Its fixed SQL names cannot be supplied as arguments.

## Admission and create

Run `pnpm --filter @forge/admin watch-exposure:index:online inspect` in the deployed image with `DATABASE_URL` and `RAILWAY_GIT_COMMIT_SHA`. Record its SHA-256 `targetHash` (database, current schema, server address/port), `sourceHash` (actual CLI source bytes), deployed revision, catalog definitions/validity, heap/total/index bytes, WAL LSN and active-build/lock/old-transaction counts. Inspect is read-only even if the schema is unexpected; a mutating command then fails closed. Confirm the target independently, not from a pasted URL alone. The mutating command requires the exact reviewed hashes and revision as arguments plus an absolute, new private receipt path.

```sh
pnpm --filter @forge/admin watch-exposure:index:online create-narrow \
  --execute --target=<reviewed-64-hex-hash> \
  --source=<reviewed-64-hex-hash> --revision=<deployed-40-hex-sha> \
  --receipt=/secure/one-shot-create-receipt.json
```

Before DDL the CLI requires the valid, ready, live, ordinary, nonunique eight-key B-tree index `(window_id,surface,block,presentation,placement,position,item_path,kind)`, no relation named for the six-key candidate, no constraint attachment, no active build on the table, and no current table lock waiter or transaction older than five seconds. It takes a dedicated session advisory lock, writes and fsyncs the one-shot receipt with mode 0600 and fsyncs its parent directory, sets `lock_timeout=250ms` and `statement_timeout=120s`, then issues a top-level `CREATE INDEX CONCURRENTLY` on the first six columns. The `pg` client has a 2-second connection timeout and a 125-second query timeout. A query/transport timeout is **uncertain**, regardless of exit code; inspect catalog and active backend before any further action. No auto retry, `IF NOT EXISTS`, `REINDEX`, invalid-index cleanup, or fallback ordinary build exists.

After create, require both old and new indexes valid/ready/live with exact definitions. Keep the old one during a separate observation period. Compare exact eight-filter hit, six-key window, `window_id+kind`, 18-event sibling, cohort reporting, ingest replay, expiry and exposed HTTP write/read latency. Admission must include free disk for both indexes and WAL, plus observed error/lock rates. A candidate that is invalid or harmful is an operator stop; repair/removal needs separate review.

## Separate drop

After fresh independent health, target, source, space, WAL and catalog admission, and only when the candidate has been accepted, invoke the same deployed CLI with `drop-wide` and a different unused private receipt path. The command requires both exact valid index shapes and issues only `DROP INDEX CONCURRENTLY public.watch_surface_exposure_window_item_idx`, with no `IF EXISTS` or `CASCADE`. The six-key index remains. A failed or ambiguous drop is inspected, never resumed automatically. If reads regress, keep the old index and stop before the drop. After dropping it, restoring the wide index requires another reviewed concurrent build; changing code flags cannot restore it instantly. Record `pg_relation_size`, `pg_total_relation_size`, filesystem free bytes after WAL settles, WAL interval, event UUID/row counts, 29-day expiry, read plans and serving/writer metrics. Relation-byte change is not automatically filesystem recovery.

## Later Prisma reconciliation, separate PR

Only after the physical production state is verified, change Prisma's model to the six-column index and append a **forward-only** migration. Do not edit migration 0103. The migration should have two fail-closed branches under bounded timeouts: (1) on a populated database, verify the candidate is already valid with the reviewed six-key definition and the old index absent, then do no DDL; otherwise fail; (2) on a genuinely empty new database, acquire a bounded table lock, recheck emptiness under it, then create the narrow index ordinarily and remove the old one transactionally. A partial online state (both indexes, invalid candidate, old-only populated, or neither) must fail rather than block live writers. Test actual `prisma migrate deploy` from zero and against an already-online populated fixture. This operator PR intentionally contains no schema or migration change.

## Local proof boundary

The 1.5-million-row PostgreSQL 18 fixture and online DDL receipt are under `/tmp/forge-exposure-online-proof-20260930/feasibility.md`. It used a favorable 96-character path distribution, not production cardinality; its observed 246.7 MB index delta and sub-1.5-second fixture writes are not a production forecast. Actual production operations require the root-owned rollout admission above.
