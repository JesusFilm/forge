# Admin App — Handoff Document

## Current State (2026-04-14)

The admin app at `apps/admin/` is architecturally complete. 12 of 13 plan
units are shipped across 7 stacked branches (PRs #754–#767). Unit 12
(dashboard UI) is in progress via a parallel Stitch design agent.

**389 tests. Typecheck, lint, build all green.**

### What's working

- **Auth:** Better Auth with cross-subdomain cookies (`.jesusfilm.org`),
  Firebase email/password lazy migration, SSO (Facebook/Google/Apple/Okta),
  per-IP rate limiting on sign-in endpoint. Sign-up is open (shared auth
  service). Session → Principal mapping wired into GraphQL context.
- **GraphQL API:** Yoga + Pothos + Prisma plugin + scope-auth. 20 queries
  and mutations exposed. Armor plugins (depth/alias/token/cost limits),
  introspection gated by env, CORS fail-closed.
- **Permission system:** Two-layer RBAC+ABAC. `hasPermission` (tier-only)
  at scope-auth + named ABAC helpers (`canEdit*`, `canPublish*`, etc.) in
  services. Classification test enforces JSDoc tags on every Pothos type.
- **Service layer:** ExperienceService (full CRUD + ABAC), VideoService
  (read-only), ExperienceSearchService (pgvector + Search Hydration
  Pattern). Shared `ForbiddenError`/`NotFoundError` in `services/errors.ts`.
- **Core sync:** Orchestrator with DB-backed lock, watermark
  (capture-before-fetch), 5 phases (languages → countries → keywords →
  videos → video-dubs), `source='manager'` short-circuit, revival logic.
- **Workflow infrastructure:** `withWorkflow` wired in `next.config.ts`,
  HMAC-authenticated workflow endpoint with key rotation.
- **Storage:** Railway S3 adapter with local `.tmp/` fallback.
- **Documentation:** `docs/add-a-new-entity.md` playbook, 3 pattern docs
  (search hydration, permissions, workflows), 12 compound learnings in
  `docs/solutions/`.

### Branches (stacked)

```
main
 └── feat/admin-app-phase-3  (PR #754 — Unit 6: permissions)
      └── feat/admin-app-phase-4  (PR #758 — Units 5, 7, 8: auth + services + search)
           └── feat/admin-app-phase-5  (PR #765 — Unit 9: security hardening)
                └── feat/admin-app-phase-6  (PR #766 — Unit 10: Core sync)
                     └── feat/admin-app-phase-7  (PR #767 — Units 11+13: workflow + storage + docs)
```

Merge in order. Each PR's base is the previous phase branch.

---

## Outstanding Work

### P0 — Required before production deploy

#### 1. Core sync staging validation

**Branch:** `feat/admin-app-phase-6` or new branch off phase-7

**What:** Run the sync against the real Core API
(`https://api-gateway.central.jesusfilm.org/`) and fix issues.

**Why:** The 5 sync phases have Core GraphQL queries that are plausible
but written without access to the actual Core schema. Field names,
nesting structure, pagination arguments, and response shapes may differ.

**Files:**

- `src/services/core-sync/phases/sync-languages.ts` (line 13: `LANGUAGES_QUERY`)
- `src/services/core-sync/phases/sync-countries.ts` (line 12: `COUNTRIES_QUERY`)
- `src/services/core-sync/phases/sync-keywords.ts` (line 11: `KEYWORDS_QUERY`)
- `src/services/core-sync/phases/sync-videos.ts` (line 13: `VIDEOS_QUERY`)
- `src/services/core-sync/phases/sync-dubs.ts` (line 14: `DUBS_QUERY`)

**Steps:**

1. Set `CORE_API_URL` and `CORE_API_TOKEN` in Doppler (forge-admin dev)
2. Run `triggerSync(scope: "languages")` via GraphQL playground
3. Check server logs for Core API errors and Prisma constraint violations
4. Fix query shapes and transform logic per phase
5. Run full sync: `triggerSync(scope: "all", incremental: false)`
6. Verify `systemStatus` shows row counts matching Core

**Reference:** CMS sync queries in `apps/cms/src/api/core-sync/services/`
have the known-working Core query shapes.

#### 2. Add Zod validation to Core sync phases

**What:** Each phase should parse Core API responses through a Zod schema
before processing. Currently, raw responses are cast to TypeScript types
via generic parameters (erased at runtime).

**Files to create:**

- `src/services/core-sync/schemas/language.ts`
- `src/services/core-sync/schemas/country.ts`
- `src/services/core-sync/schemas/keyword.ts`
- `src/services/core-sync/schemas/video.ts`
- `src/services/core-sync/schemas/dub.ts`

**Pattern:** Each schema matches the `Core*` type in the corresponding
phase file. Parse each page: `const languages = LanguageSchema.array().parse(result.data?.languages ?? [])`.
On parse failure, increment `stats.errors` and continue (don't throw).

#### 3. Core sync soft-delete + circuit breaker

**What:** On full (non-incremental) sync, rows with `source='core'` that
were NOT seen during the sync should have `deletedAt` set. A circuit
breaker must abort the soft-delete if the first page returns 0 records
(protects against Core API outages mass-deleting local data).

**Files:** All 5 phase files in `src/services/core-sync/phases/`

**Pattern:**

1. Track `seenCoreIds: Set<string>` during the full sync
2. After all pages processed, if `seenCoreIds.size > 0`:
   ```
   UPDATE <table> SET deleted_at = NOW()
   WHERE source = 'core' AND core_id NOT IN (...seenCoreIds) AND deleted_at IS NULL
   ```
3. Circuit breaker: if first page returned 0 and `since` is undefined
   (full sync), skip the soft-delete and log a warning

**Tests:** Add tests for both paths (soft-delete + circuit breaker abort).

#### 4. Per-page $transaction in sync phases

**What:** Each page's upsert loop should be wrapped in a Prisma
interactive `$transaction` so a crash mid-page doesn't leave partial
state (e.g., Video created without its VideoLocale rows).

**Pattern:**

```ts
await prisma.$transaction(async (tx) => {
  for (const item of page) {
    await tx.entity.upsert(...)
  }
}, { timeout: 5000, maxWait: 2000 })
```

**Files:** All 5 phase files.

#### 5. Redis-backed GraphQL rate limiter

**What:** Swap `InMemoryStore` for `RedisStore` in the GraphQL rate
limiter. InMemoryStore doesn't work across Railway instances.

**File:** `src/graphql/plugins/rate-limit.ts`

**Pattern:** Import `RedisStore` from `@envelop/rate-limiter`. Use the
same Redis connection config as `src/auth/rate-limit.ts`
(`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`). Fail closed in production
when Redis is unreachable.

#### 6. Embedding generation workflow

**What:** Create the workflow that generates pgvector embeddings for
ExperienceLocale rows. The search service and HNSW index are in place
but no embeddings exist yet.

**Files to create:**

- `src/services/embeddings.service.ts` — OpenRouter/OpenAI client that
  takes text and returns a 1536-dimension embedding vector
- `src/workflows/experienceEmbedding.ts` — `"use workflow"` that:
  1. Loads the ExperienceLocale (title + blocks text)
  2. Calls the embedding service
  3. Writes the vector to the `embedding` column via raw SQL
     (Prisma can't write `Unsupported("vector(1536)")` columns)

**GraphQL mutation:** `triggerExperienceEmbedding(localeId: ID!)` in
`src/graphql/mutations/experience.ts` — EDITOR (own) or ADMIN can trigger.

**Reference:** `apps/manager/src/services/embeddings.ts` for the OpenAI
client pattern. The embedding must use `$executeRaw` with `::vector` cast.

#### 7. Prisma Client extension for embedding stripping

**What:** Defense-in-depth extension that strips the `embedding` column
from all Prisma query results unless the caller explicitly opts in.
Prevents embedding vectors from leaking through JSON scalar fields or
future code that accidentally returns `...row`.

**File:** `src/db/client.ts` — add a Prisma client extension via
`prisma.$extends(...)`.

**Pattern:** Intercept all query results and delete `embedding` from
returned rows. The embedding workflow service passes a flag
(`__includeEmbedding: true`) to opt in.

---

### P1 — Required before consumer migration (web/mobile switch)

#### 8. Consumer migration adapter

**What:** When `apps/web` and `apps/mobile-v2` are ready to switch from
Strapi to the admin API, they need either:

- (a) A compatibility layer that maps admin's query/field names to match
  the existing gql.tada schema in `packages/graphql`, OR
- (b) A codegen update that regenerates `packages/graphql` from the
  admin schema and a sweep of all consuming code

**Decision needed:** Which approach? Option (b) is cleaner but more work
upfront. Option (a) is a shim that gets deleted later.

**Files affected:**

- `packages/graphql/` — schema source + generated types
- `apps/web/src/lib/content.ts` — all GraphQL operations
- `apps/mobile-v2/` — GraphQL operations

#### 9. Prefetch-next-page pipelining in Core sync

**What:** Currently each sync phase fetches one page, processes it, then
fetches the next (sequential). The plan calls for prefetch pipelining:
start fetching page N+1 while processing page N.

**Pattern:** (from CMS sync-videos.ts)

```ts
let pendingFetch = coreQuery(offset + PAGE_SIZE)
// ... process current page ...
const nextResult = await pendingFetch
```

**Files:** All 5 phase files.

#### 10. `stats.created` vs `stats.updated` accuracy

**What:** All sync phases increment `stats.updated` on every upsert.
`stats.created` is never set. The `systemStatus` query shows misleading
counts. Either pre-read to distinguish create vs update, or rename the
field to `processed`.

---

### P2 — Nice to have

#### 11. ABAC parity test (runtime)

**What:** The `test.todo` in `classification.test.ts` — for every
abac-gated type, assert that `Query.t(id)` and every `X.t` relation
path return the same row set for the same principal against a live
seeded Postgres. Currently the classification test is static only
(regex-based JSDoc parsing).

**File:** `src/graphql/classification.test.ts` (line ~181)

#### 12. Resolver-surface embedding exclusion test

**What:** The plan called for executing resolvers against fixture rows
with known embedding vectors and asserting the serialized JSON response
never contains a 1536-length numeric array. The current test only checks
field names.

**File:** `src/graphql/schema.security.test.ts`

#### 13. ContentRevision integration in service mutations

**What:** The CLAUDE.md documents the editor flow: mutations should
create/update DRAFT revisions in the same `$transaction`. The revision
table exists (ContentRevision model) but no service method writes to it.

**Pattern:** (from CLAUDE.md)

```ts
async updateExperienceLocale(input, user) {
  return prisma.$transaction(async (tx) => {
    // 1. Upsert DRAFT revision with snapshot of current state
    // 2. Apply the update to canonical row
  })
}
```

---

## Key Files to Read First

1. `apps/admin/CLAUDE.md` — architecture, conventions, all unit summaries
2. `apps/admin/docs/add-a-new-entity.md` — the step-by-step playbook
3. `apps/admin/src/auth/permissions.ts` — the permission matrix
4. `apps/admin/src/services/experience.service.ts` — canonical service pattern
5. `apps/admin/src/services/core-sync/orchestrator.ts` — sync coordination
6. `apps/admin/src/graphql/types/experience.ts` — canonical Pothos type with ABAC relation filtering

## Environment

- **Doppler project:** `forge-admin` (dev config has all env vars)
- **Database:** PostgreSQL with pgvector at `db:5432/forge_admin`
- **Redis:** `redis:6379` (no auth in devcontainer)
- **Ports:** `localhost:3003` (dev server)
- **Dev commands:**
  ```bash
  pnpm fetch-secrets                    # Pull .env from Doppler
  pnpm --filter @forge/admin dev        # http://localhost:3003
  pnpm --filter @forge/admin test       # 389 tests
  pnpm --filter @forge/admin typecheck
  pnpm --filter @forge/admin lint
  pnpm --filter @forge/admin build
  ```

## Compound Learnings (docs/solutions/)

These capture non-obvious patterns discovered during development:

1. `auth/spike-auth-header-must-be-env-gated.md` — placeholder auth needs NODE_ENV gate
2. `auth/better-auth-secret-must-not-fallback-to-hardcoded-value.md` — runtime production guard with NEXT_PHASE skip
3. `auth/better-auth-firebase-migration-must-block-public-signup.md` — sign-up blocking pattern (now removed since auth is shared service)
4. `graphql/pothos-prisma-shared-enum-module.md` — enum dedup pattern
5. `graphql/pothos-relation-abac-filter-required-for-nested-types.md` — t.relation needs query callback for ABAC
6. `database-issues/set-local-requires-transaction-for-pgvector-search.md` — SET LOCAL + $transaction
7. `database-issues/db-lock-must-be-atomic-update-not-select-for-update.md` — atomic lock pattern
8. `security-issues/yoga-cors-origin-undefined-allows-all-origins.md` — CORS fail-closed

## Architecture Decisions

Key decisions made during this build that should not be reversed:

- **Auth is the shared identity service** for all `*.jesusfilm.org` apps. Sign-up is open. Access is role-gated, not registration-gated.
- **`AUTH_COOKIE_DOMAIN=.jesusfilm.org`** in production for cross-subdomain sessions.
- **SYSTEM principal is never mintable from HTTP.** Workflow trust boundary is in-process only.
- **`source='manager'` rows are never overwritten by Core sync.** This is the data sovereignty contract.
- **Embedding vectors are NEVER exposed via GraphQL.** Technical control, not naming convention.
- **Per-locale rows** (not JSONB-per-field) for Experience and Video content.
- **VideoDub** (not VideoVariant) — the varying axis is audio language, not frames.
