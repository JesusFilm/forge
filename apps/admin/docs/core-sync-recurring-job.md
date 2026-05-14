# Core Sync Recurring Job

Admin runs Core Sync through the useworkflow runtime. The sync engine remains
`runSync()`; the recurring path dispatches `runCoreSync` and the workflow step
calls `runSync(syncPrisma, ...)`.

## Required Env

- `DATABASE_URL` - admin app database.
- `DATABASE_URL_SYNC` - dedicated Prisma pool for Core Sync. Use a small pool,
  for example `connection_limit=2`.
- `WORKFLOW_TARGET_WORLD` - set to `@workflow/world-postgres` in Railway.
- `WORKFLOW_RUNNER_ENABLED` - set to `true` only on the dedicated admin worker
  service that should execute Postgres World jobs. Leave unset or `false` on
  the admin web service so web replicas can scale without also running workers.
- `WORKFLOW_POSTGRES_URL` - Postgres World storage database. Use the admin
  database when the workflows run index and detail routes should read runtime
  rows alongside admin ledger context.
- `WORKFLOW_POSTGRES_JOB_PREFIX` - recommended: `forge_admin`.
- `WORKFLOW_POSTGRES_WORKER_CONCURRENCY` - recommended starting point: `2`.
- `WORKFLOW_POSTGRES_MAX_POOL_SIZE` - recommended starting point: `4`.
- `WORKFLOW_API_KEYS` and `WORKFLOW_HMAC_SECRET` - workflow callback signing.
- `AUTH_COOKIE_PREFIX` - optional local-preview cookie namespace. Set this to
  a unique value when multiple worktrees run on `localhost` so signing in on
  one branch does not overwrite another branch's Better Auth cookie.
- `CORE_API_URL`, `CORE_API_TOKEN`, `CORE_API_TIMEOUT_MS`,
  `CORE_API_RETRIES` - Core API access.
- `CORE_SYNC_CRON_SECRET` - bearer token for `/api/core-sync/scheduled`.

## Railway Setup

1. Provision the env vars above on the admin service.
2. Run the admin Prisma migration deploy command:

   ```bash
   pnpm --filter @forge/admin db:migrate:deploy
   ```

3. Run the Postgres World setup command after `WORKFLOW_POSTGRES_URL` is set:

   ```bash
   pnpm --filter @forge/admin workflow:setup:postgres
   ```

   The command is idempotent and creates the Workflow runtime tables for runs,
   events, steps, hooks, and streams.

4. Deploy a dedicated admin worker service from the same admin build. Postgres
   World requires the Node process to call `world.start()` on server
   initialization; admin does this in `src/instrumentation.ts` only when
   `WORKFLOW_RUNNER_ENABLED=true` and `WORKFLOW_TARGET_WORLD` is
   `@workflow/world-postgres`. The web service can keep `WORKFLOW_TARGET_WORLD`
   and `WORKFLOW_POSTGRES_URL` for dashboard reads, but should leave
   `WORKFLOW_RUNNER_ENABLED` unset or `false`.
5. Configure Railway cron or another external scheduler to call:

   ```bash
   curl -X POST "$ADMIN_URL/api/core-sync/scheduled" \
     -H "Authorization: Bearer $CORE_SYNC_CRON_SECRET"
   ```

## Post-Deploy Verification

1. Confirm the scheduled endpoint rejects missing or wrong auth with `401`.
2. Call the scheduled endpoint with the configured bearer token and expect
   `202` plus queued workflow metadata.
3. Confirm Postgres World has a runtime row:

   ```bash
   WORKFLOW_POSTGRES_URL="$WORKFLOW_POSTGRES_URL" \
     pnpm --filter @forge/admin exec workflow inspect runs --backend @workflow/world-postgres
   ```

4. Confirm `workflow_run.runtime_run_id` is populated for the dispatch.
5. Confirm `core_sync_run` is written when the workflow completes.
6. Confirm `sync_locks` clears after execution.
7. Confirm `sync_state` watermarks advance for zero-error phases.
8. Confirm `/dashboard/system-status` shows Core Sync lock, phase, coverage
   audit, and latest-run posture.
9. Confirm `/dashboard/workflows` lists Postgres World runtime rows.
10. Open `/dashboard/workflows/<runId>` for a recent run and confirm the
    embedded `@workflow/web-shared` trace/detail view shows runtime events.

## Local Benchmark Plan

Run these against local Docker Postgres or a disposable Railway database:

```bash
time pnpm --filter @forge/admin core-sync:run -- --full
time pnpm --filter @forge/admin core-sync:run
time pnpm --filter @forge/admin core-sync:run
```

Record:

- clean/full sync runtime,
- no-op incremental runtime,
- typical delta runtime if sample Core changes are available,
- peak row-volume phase,
- whether the machine can keep the admin app responsive during sync.

This worktree could not run the benchmark because local Postgres is not
listening on `localhost:5432` and Docker is unavailable. Do not use a shared
production-like admin database for benchmark writes unless the database has
been explicitly designated disposable.
