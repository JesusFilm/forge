# Admin Worktree Preview Setup

Use this guide when an agent needs to stand up `apps/admin` from a feature
worktree against an isolated Postgres database. The goal is a disposable preview
that can run migrations, authenticate without clobbering other local branches,
and exercise dashboard/workflow behavior safely.

## 1. Pick the Source Database

Most dev containers expose Postgres at `db:5432`, not `localhost:5432`.
Confirm the source database first:

```bash
pg_isready -h db -p 5432 -U forge -d forge_admin
```

Check size before copying:

```bash
PGPASSWORD=forge psql -h db -p 5432 -U forge -d postgres -Atc \
  "SELECT datname, pg_size_pretty(pg_database_size(datname))
   FROM pg_database
   WHERE datname = 'forge_admin';"
```

If the source database has migration history from another branch, do not mutate
it for your worktree. Copy it first.

## 2. Create a Disposable Copy

Use a name that includes the branch or feature and a timestamp:

```bash
FEATURE="core_sync_preview"
NEW_DB="forge_admin_${FEATURE}_$(date -u +%Y%m%d_%H%M)"
PGPASSWORD=forge createdb -h db -p 5432 -U forge "$NEW_DB"
PGPASSWORD=forge pg_dump -h db -p 5432 -U forge -d forge_admin \
  --no-owner --no-privileges |
  PGPASSWORD=forge psql -h db -p 5432 -U forge -d "$NEW_DB" -v ON_ERROR_STOP=1
```

Sanity-check expected admin tables:

```bash
PGPASSWORD=forge psql -h db -p 5432 -U forge -d "$NEW_DB" -Atc \
  "SELECT 'user=' || count(*) FROM \"user\"
   UNION ALL SELECT 'sync_state=' || count(*) FROM sync_state
   UNION ALL SELECT 'video=' || count(*) FROM video;"
```

## 3. Apply This Worktree's Migrations

Point Prisma at the copied database, not the shared source:

```bash
DATABASE_URL="postgresql://forge:forge@db:5432/$NEW_DB" \
  pnpm --filter @forge/admin exec prisma migrate deploy
```

If the branch uses Workflow Postgres World, install its runtime schema too:

```bash
DATABASE_URL="postgresql://forge:forge@db:5432/$NEW_DB" \
WORKFLOW_POSTGRES_URL="postgresql://forge:forge@db:5432/$NEW_DB?connection_limit=4&pool_timeout=20" \
  pnpm --filter @forge/admin workflow:setup:postgres
```

This creates the `workflow.*` tables used by runtime runs, steps, events, hooks,
and streams. Admin-owned workflow ledger tables still come from Prisma
migrations.

## 4. Isolate Admin OAuth Sessions

Browsers scope cookies by host, not port. All of these share the same
`localhost` cookie jar:

- `http://localhost:3003`
- `http://localhost:3013`
- `http://localhost:3023`

Without an isolated cookie prefix, signing in on one branch can overwrite the
admin-local OAuth session cookie used by another branch. Always set a
worktree-specific `AUTH_COOKIE_PREFIX` for previews that run alongside other
branches.

Recommended local auth env:

```bash
PORT=3013
FEATURE="core-sync-preview"
AUTH_ISSUER_URL="https://auth.jesusfilm.org/api/auth"
AUTH_ADMIN_CLIENT_ID="jfp_admin_local"
ADMIN_BASE_URL="http://localhost:${PORT}"
AUTH_COOKIE_PREFIX="forge-admin-${FEATURE}"
ADMIN_SESSION_SECRET="forge-admin-local-dev-secret-change-me-before-production-00"
```

Rules of thumb:

- Same `ADMIN_SESSION_SECRET` lets branches validate the same admin-local session
  signature.
- Same DB plus same secret lets a local admin session survive across branches.
- Different DB copies still need separate cookie prefixes, because the session
  references users and roles in that DB.
- Add the preview OAuth redirect URI to Auth before using a non-default port, or Auth
  will reject the OAuth request.

## 5. Start the Preview Server

Pick an open port:

```bash
for p in 3003 3013 3023; do
  if ! ss -ltn | awk '{print $4}' | rg -q ":$p$"; then echo "$p"; break; fi
done
```

Start Next directly from `apps/admin` so custom host/port args work:

```bash
cd apps/admin

PORT=3013
FEATURE="core-sync-preview"

DATABASE_URL="postgresql://forge:forge@db:5432/$NEW_DB" \
WORKFLOW_TARGET_WORLD="@workflow/world-postgres" \
WORKFLOW_POSTGRES_URL="postgresql://forge:forge@db:5432/$NEW_DB?connection_limit=4&pool_timeout=20" \
WORKFLOW_POSTGRES_JOB_PREFIX="forge_admin_${FEATURE}" \
WORKFLOW_POSTGRES_WORKER_CONCURRENCY=2 \
WORKFLOW_POSTGRES_MAX_POOL_SIZE=4 \
AUTH_ISSUER_URL="https://auth.jesusfilm.org/api/auth" \
AUTH_ADMIN_CLIENT_ID="jfp_admin_local" \
ADMIN_BASE_URL="http://localhost:${PORT}" \
AUTH_COOKIE_PREFIX="forge-admin-${FEATURE}" \
ADMIN_SESSION_SECRET="forge-admin-local-dev-secret-change-me-before-production-00" \
CORE_SYNC_CRON_SECRET="local-dev-core-sync-secret" \
pnpm exec next dev --hostname 0.0.0.0 --port "$PORT"
```

For branches that do not need Workflow Postgres World, omit the
`WORKFLOW_TARGET_WORLD` and `WORKFLOW_POSTGRES_*` vars. The bundled local world
is enough for basic page previews but is not durable across process restarts.

## 6. Verify the Preview

Check the Auth redirect:

```bash
curl -I -sS "http://localhost:${PORT}/api/auth/login?returnTo=/dashboard" | sed -n '1,20p'
```

Protected routes should redirect before sign-in and return `200` after sign-in:

```bash
curl -I -sS "http://localhost:${PORT}/dashboard/workflows" | sed -n '1,20p'
curl -I -sS "http://localhost:${PORT}/dashboard/system-status" | sed -n '1,20p'
```

For UI smoke checks, click between `/dashboard/videos` and
`/dashboard/languages` after sign-in so the persistent shell, route loading
states, and dashboard data boundaries all run through the browser.

If Workflow Postgres World has runtime rows, open
`/dashboard/workflows/<runId>` in the browser to smoke the embedded
`@workflow/web-shared` trace/detail view.

For Workflow/Postgres previews, confirm schemas exist:

```bash
PGPASSWORD=forge psql -h db -p 5432 -U forge -d "$NEW_DB" -Atc \
  "SELECT 'workflow_run=' || COALESCE(to_regclass('public.workflow_run')::text,'missing')
   UNION ALL SELECT 'core_sync_run=' || COALESCE(to_regclass('public.core_sync_run')::text,'missing')
   UNION ALL SELECT 'runtime_runs=' || COALESCE(to_regclass('workflow.workflow_runs')::text,'missing');"
```

## 7. Running Core Sync Safely

Use the copied database for benchmarks or manual sync tests:

```bash
DATABASE_URL="postgresql://forge:forge@db:5432/$NEW_DB" \
  pnpm --filter @forge/admin core-sync:run -- --scope=languages
```

Start with a narrow scope before full sync. Never benchmark against a shared
production-like admin database unless it has been explicitly designated
disposable.

## 8. Cleanup

When the preview is no longer needed:

```bash
PGPASSWORD=forge dropdb -h db -p 5432 -U forge "$NEW_DB"
```

Stop any dev-server PTY session before dropping the database.
