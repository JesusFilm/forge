# apps/admin — Forge Admin

## What this app does

Custom management platform — the strategic replacement for Strapi and
eventual home for the manager app. V1 ships the architecture (Next.js +
GraphQL Yoga + Pothos + Prisma + pgvector + useworkflow + Better Auth)
and proves it with real content types (Experiences, Videos) while Strapi
continues to serve existing consumers.

See the origin docs for full context:

- Requirements: `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md`
- Plan: `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md`
- V1 operational surfaces: `apps/admin/docs/v1-operational-surfaces.md`
- Worktree preview setup: `apps/admin/docs/worktree-preview-setup.md`

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- GraphQL Yoga + Pothos (with Prisma + scope-auth plugins) — single API at `/api/graphql`
- Prisma 6.x + PostgreSQL + pgvector (HNSW index) — sole data access layer
- Better Auth (DB-backed sessions, cross-subdomain cookies) + server-side Firebase email/password fallback for transparent migration
- SSO via Better Auth adapters/plugins: Facebook, Google, Apple, Okta
- Auth is subdomain-scoped: cookie domain set via `AUTH_COOKIE_DOMAIN` (`.jesusfilm.org` in prod) so all apps on `*.jesusfilm.org` share the session
- useworkflow (`workflow` npm package) for durable background jobs
- Redis (TCP via `ioredis`) for rate limiting
- Railway deployment (NIXPACKS, standalone output)
- Doppler for env var management (project: `forge-admin`)

## Folder structure

```
src/
  app/               Next.js App Router pages and API routes
  config/env.ts      Validated env (t3-oss/env-nextjs + zod)
  db/                Prisma client singleton + pgvector helpers         [Unit 2]
  auth/              Better Auth config + permissions + Firebase bridge [Units 5-6]
  graphql/           Pothos schema + resolvers                          [Units 3,4,6-9]
  services/          Business logic, raw SQL, ABAC checks               [Units 7-10]
  workflows/         Durable workflow definitions                       [Unit 11]
  storage/           Railway S3 adapter                                 [Unit 11]
```

## Build status

- [x] Unit 1: Scaffold + env + tests + lint + Railway config
- [x] Unit 2: Prisma + pgvector
- [x] Unit 3: GraphQL architecture spike — **signed off against a live Postgres 2026-04-13**
- [x] Unit 4: Experience + Video Prisma models + block Zod union + Pothos types
- [x] Unit 5: Better Auth + Firebase fallback
- [x] Unit 6: Permission system + per-request DataLoaders + scope-auth wiring + classification enforcement
- [x] Unit 7: Service layer + Experience CRUD with ABAC
- [x] Unit 8: Video read service + pgvector experience search
- [x] Unit 9: GraphQL security hardening (Armor + rate limit + introspection gate + CORS)
- [x] Unit 10: Core API sync orchestrator + 5 phases
- [x] Unit 11: useworkflow plugin + workflow endpoint auth + storage service
- [x] Unit 12: Admin dashboard operationalized for v1 (no stub routes; live ops surfaces)
- [x] Unit 13: CLAUDE.md playbook + add-a-new-entity guide + pattern docs

## Permission system (Unit 6)

Two layers, kept deliberately separate:

1. **`hasPermission(user, key)`** in `src/auth/permissions.ts` — coarse
   tier-only gate consulted by Pothos scope-auth
   (`authScopes: { hasPermission: 'read:experiences' }`). Resolves a
   `PermissionKey` against a 4-tier ladder (PUBLIC → VIEWER → EDITOR →
   ADMIN, plus orthogonal SYSTEM workflow tier). ADMIN is the operational
   override and satisfies SYSTEM gates too. Adding a new permission key
   requires a matrix entry in the same file — TypeScript compile error
   if missing.

2. **Named ABAC helpers** (`canEditExperience(user, experience)`,
   `canPublishExperienceLocale(...)`, etc.) — fine-grained, accept the
   entity in question, encode ownership and state rules. Service code
   MUST call these at the top of every mutation. The convention will be
   testable once Unit 7 services exist.

Service-layer rule (lands in Unit 7):

```ts
async updateExperienceLocale(input, user) {
  const before = await prisma.experienceLocale.findUniqueOrThrow(...)
  if (!canEditExperienceLocale(user, before)) throw new ForbiddenError()
  return prisma.$transaction(async (tx) => { ... })
}
```

Pothos type classification is enforced by
`src/graphql/classification.test.ts`:

- Every `builder.prismaObject(...)` call must have a JSDoc
  `@classification abac-gated` or `@classification public-shape` tag.
- No `public-shape` type may have a `t.relation(...)` whose target is
  `abac-gated` — that would let a public read reach ABAC-gated data
  without ABAC. Add the relation to the test's per-parent registry when
  exposing a new abac-gated relation.
- The runtime ABAC parity test — for every abac-gated type, assert that
  `Query.t(id)` and every `X.t` / `X.ts` relation path that reaches that
  type return the same row set for the same principal against a live
  seeded Postgres — is a `test.todo` placeholder until Unit 7 services
  exist. Once services land, the todo becomes a DB-backed test seeded
  with ≥1 row the caller should see and ≥1 row they should NOT see (per
  principal). A divergence means a relation is bypassing the service's
  ABAC WHERE.

Per-request DataLoaders live in `src/graphql/loaders.ts` and are
instantiated by `createContext` once per request. Use them in services
that hydrate by id outside the Pothos `...query` happy path (e.g., the
vector-search Search Hydration Pattern).

**When to add a new loader:**

1. Your service returns IDs (not rows) — usually from raw SQL or an
   external ID list (embedding search, recommendation engine, Core sync
   returning `coreId` lists).
2. Callers need the hydrated Prisma row, not just the id.
3. The same request likely hydrates more than one id — batching is what
   earns DataLoader its keep.

Recipe:

```ts
// src/graphql/loaders.ts — add inside createLoaders return object.
myEntityById: new DataLoader<string, MyEntityRow | null>(async (ids) => {
  const rows = await prisma.myEntity.findMany({
    where: { id: { in: ids as string[] } },
  })
  return mapToInputOrder(ids, rows, (r) => r.id)
}),
```

Then call `ctx.loaders.myEntityById.load(id)` from the service. Never
cache loader instances across requests — `createContext` builds fresh
instances per request so one principal's cached row never leaks to
another principal's query.

**When NOT to add a loader:** if your access path is `Query.x(id)` →
Pothos resolver → Prisma with the Pothos `...query` argument, the Prisma
plugin already issues a single batched query. Adding a DataLoader on top
is redundant and loses the plugin's column-pruning.

## Conventions (Unit 1 baseline — expands with each unit)

- Env vars validated at startup via `src/config/env.ts`. Never read `process.env` directly.
- Env vars managed by Doppler (project: `forge-admin`). Use `pnpm fetch-secrets` for local dev.
- Tests colocated as `*.test.ts` / `*.test.tsx` beside source files.
- **Adding a new Pothos type** requires three steps:
  1. Create `src/graphql/types/<name>.ts` and call `builder.prismaObject(...)`
  2. Add a side-effect import in `src/graphql/schema.ts` so the type registers on the builder before `builder.toSchema()` runs
  3. Order matters: `src/graphql/types/reference.ts` must be imported first because it registers the shared `JSON` scalar and `LocaleStatusEnum`. Other type files import from `reference.ts` to reuse them.
     Forgetting step 2 produces a silent omission — no build error, just a missing type at runtime.

## Development

```bash
pnpm fetch-secrets    # Pull .env from Doppler (forge-admin)
pnpm --filter @forge/admin dev           # http://localhost:3003
pnpm --filter @forge/admin build
pnpm --filter @forge/admin test
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin typecheck
```

## Deployment

Railway service `@forge/admin` in project `forge` (Doppler project
`forge-admin` of the same name). The service is **configured via the
Railway dashboard, NOT via `apps/admin/railway.toml`** — that file is
dead config until the service's "Config-as-code Path" is wired up
(see `apps/admin/railway.toml` header comment + the solutions doc
linked below).

**Authoritative dashboard configuration (as of 2026-04-29 recovery):**

| Field                      | Value                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom Start Command       | `pnpm --filter @forge/admin db:migrate:deploy && HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js`                                  |
| Custom Build Command       | `pnpm install --frozen-lockfile && pnpm --filter @forge/admin build && cp -r apps/admin/.next/static apps/admin/.next/standalone/apps/admin/.next/static` |
| Custom Pre-Deploy Command  | (not set — migrate is chained into startCommand)                                                                                                          |
| Healthcheck Path           | `/api/health`                                                                                                                                             |
| Healthcheck Timeout        | 60s                                                                                                                                                       |
| Restart Policy Max Retries | 3                                                                                                                                                         |

The chained `startCommand` runs Prisma migrations BEFORE the
standalone Next.js server boots. If `migrate deploy` fails, the
container crashes and `restartPolicy` retries up to 3 times before
the deploy is marked FAILED (see Migrations section for failure-mode
recovery). Other deployment caveats in
`docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
still apply: set `HOSTNAME=0.0.0.0` in the Railway dashboard (not
`[deploy.env]`).

**Editing dashboard config via MCP:** always pair
`mcp__railway__updateServiceTool` with
`mcp__railway__accept-deploy(environmentId)` — the update tool stages
patches into a buffer and a follow-up `redeploy` will snapshot the
unchanged canonical config. See
`docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.

## Migrations

**Source of truth:** Prisma migrations in `apps/admin/prisma/migrations/`.
Future schema changes append new migration files — never rewrite
`0001_init`. Migrations apply in order at every container boot via
the chained `startCommand`.

**Forward-only.** `prisma migrate deploy` is the only correct
invocation against a deployed environment. NEVER run `prisma migrate
dev` against prod or any deployed env. Rolling back to an earlier
image leaves the schema ahead of the code; with today's contents
(0001-0009 are all additive — new tables, new columns, new indexes)
a code-side rollback is functionally safe. The first migration that
drops or renames anything will change this rule and require a deeper
rollback playbook.

### Operational runbook — predeploy migration verification

After every deploy of `@forge/admin`, verify migrations actually
applied. The `apps/admin/railway.toml` shadow-override trap silently
skipped migrations across 5 PRs in late April 2026; verification is
mandatory until config-as-code is wired up.

**Smoke probe (run from your workstation):**

```bash
railway run pnpm --filter @forge/admin exec prisma migrate status
```

Expected healthy output: every migration in `apps/admin/prisma/migrations/`
listed as `Applied`, no `Pending` or `Following migrations have not
yet been applied` lines.

**Deploy-log probe (alternative):** grep the deploy log for
`Applying migration` lines and `All migrations have been
successfully applied`. Absence on a deploy that introduces a new
migration is a red flag — same shape as the 2026-04-29 incident.

### Failure-mode recovery

| Prisma error                                             | Cause                                                           | Recovery                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P3009** (`Migration … was rolled back, please review`) | A previous migration apply was interrupted or partially failed. | Fix the root cause (DB connectivity, privilege, etc.). Then `railway run pnpm --filter @forge/admin exec prisma migrate resolve --rolled-back <name>`. Redeploy. |
| **P3018** (`Migration cannot be applied cleanly`)        | Logical error in the migration SQL.                             | Fix the migration in a follow-up PR. Do NOT use `--applied` to fake-resolve a real failure.                                                                      |
| `permission denied for extension <name>`                 | Prod DB role lacks `CREATE` on the database.                    | Out-of-band: platform team grants `CREATE` on the role (or installs the extension directly). Redeploy.                                                           |
| `DATABASE_URL` absent / network egress fail              | Env var missing, or DB service unreachable.                     | Operator confirms env in dashboard / Doppler; verify DB service `online`. Redeploy.                                                                              |

**Manual fallback (emergency only):** if a deploy fails on
`migrate deploy` and you need to apply migrations out-of-band:

```bash
railway run pnpm --filter @forge/admin db:migrate:deploy
```

This runs the same command the chained `startCommand` would, against
the same env, without triggering a redeploy. Use sparingly — every
production migration should ideally land via a normal deploy so the
deploy log carries the audit trail.

**Key cross-references:**

- `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md` — the override-shadows-toml trap that this runbook exists to prevent recurrence of.
- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md` — staged-patch flush requirement when editing dashboard via MCP.
- `docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md` — schema.prisma placeholders for raw-SQL-managed columns.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md` — generated-column drift trap on Postgres.
- `docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md` — the recovery plan + the diagnostic walkthrough.

## Unit 4 — data model highlights

- **Experience + ExperienceLocale** with per-locale rows (independent
  publish state, unique `(locale, slug)` where `status = 'published'`).
  **`embedding` lives on `ExperienceLocale`, not on `Experience`** — search
  semantics match the user's language without leaning on multilingual-
  embedding-model approximation. `embedding` is NULL until the
  experienceEmbedding workflow runs against that locale's text. HNSW
  partial index excludes NULLs. `embedding` is NEVER exposed via GraphQL
  (technical control in `src/graphql/types/experience.ts` — field list
  omits it on both types; `src/graphql/schema.test.ts` asserts no
  `embed|vector|similarit` field leaks anywhere).
- **Video + VideoLocale + VideoDub + VideoDubDownload** with Core
  provenance (`coreId`, `source` enum, `syncedAt` — and `updatedAt`
  carries Core's authoritative timestamp on sync writes; see below).
  Source-authoritative contract: `source='manager'` rows are never
  overwritten by Core sync. `lengthInMilliseconds` is `BigInt` (int4
  truncates at 596 hours) and exposed as a string in GraphQL to preserve
  precision.
- **`VideoDub` is the rename of Core's `video-variant`.** The varying
  axis is the audio language (a dub of the parent Edition's frames),
  not the frames themselves. Boundary translation (`coreVariant → dub`)
  lives in the Core-sync transform layer (Unit 10), not at the DB.
  Quality tiers (mp4 480p, 720p, …) live in `VideoDubDownload`.
- **Core sync entity coverage is admin-native, not Strapi-shaped.** The
  approved Core projection lands in admin as:
  `Language` (+ audio preview columns), `Country`, `Continent`,
  `CountryLanguage`, `Keyword`, `Video`, `VideoLocale`, `VideoOrigin`,
  `VideoImage`, `VideoSubtitle`, `VideoStudyQuestion`, `BibleBook`,
  `BibleCitation`, `VideoKeyword`, `VideoRelation`, `VideoEdition`,
  `VideoDub`, `MuxVideo`, and `VideoDubDownload`. The old cms/Strapi sync is
  evidence for Core's fields only; admin code must continue reading Core
  directly and must not import from `apps/cms`.
- **Locale rule for Core data:** localized user-facing, retrieval-relevant, or
  UI-edited display content gets first-class rows so each locale can be
  addressed and audited independently. Videos use `VideoLocale` and
  `VideoStudyQuestion`; reference display names use `LanguageLocale`,
  `CountryLocale`, and `ContinentLocale`. Legacy JSON `name` maps remain only
  as compatibility mirrors during migration.
- **Coverage audit:** `runCoverageAudit()` in
  `src/services/core-sync/coverage-audit.ts` checks the approved entity and
  relationship classes after sync. `systemStatus` includes the latest audit
  result, and `runSync()` returns it for operator review before any consumer
  cutover or Strapi deletion work.
- **No `coreUpdatedAt` column on Core-sourced entities.** Sync writes
  Core's authoritative timestamp directly into the standard `updated_at`
  column by passing it explicitly: Prisma's `@updatedAt` only auto-fills
  when the value is omitted, so an explicit `updatedAt: coreData.updatedAt`
  in the upsert payload is respected. Local writes that don't pass
  `updatedAt` keep the auto-bump (right semantic for editor edits on
  `source='manager'` rows or future admin-authoritative entities).
  The upsert stale-write guard reads `updated_at` for ordering.
  `syncedAt` stays as the "when did admin last refresh this row"
  freshness signal.
- **`ContentRevision` is a generic, append-only revision log** covering
  the editor-mutable entity types: `ExperienceLocale`, `Experience`,
  `VideoLocale`, `Video`, `VideoDub`. One table for all of them so adding
  revision tracking to a new entity is a service-layer change, not a
  migration. Status enum: `DRAFT` (pending), `HISTORICAL` (snapshot at
  publish time), `DISCARDED` (abandoned). Partial unique index enforces
  at most one DRAFT per `(entity_type, entity_id)`. **60-day retention**
  via a Unit 11 useworkflow job (`DELETE WHERE revised_at < NOW() -
INTERVAL '60 days'`); index on `revised_at` makes pruning fast. Diffs
  computed on demand in resolvers — no pre-stored diff column.

  **Editor flow (PUBLISHED entities):**
  1. Editor opens published entity → reads canonical
  2. Edits → service creates or updates the entity's DRAFT revision
     (canonical untouched; in-flight changes can span days)
  3. Publish → service `$transaction`: snapshot canonical to HISTORICAL,
     apply DRAFT snapshot to canonical, delete DRAFT row

  **New content (no canonical yet):**
  - Service creates a stub canonical row with `status=DRAFT`
    (`LocaleStatus`) and minimum required fields filled with placeholders
  - Editor's actual content evolves in a DRAFT revision over the
    multi-day editing session
  - First publish: snapshot canonical (stub) to HISTORICAL, apply DRAFT
    to canonical, flip canonical status to PUBLISHED

  **Service-layer rule (wired in Unit 7):**
  - Any service-driven UPDATE on a covered entity creates / updates a
    revision in the same `$transaction`
  - First local edit on a `source='core'` row also flips `source` to
    `'manager'` so future Core sync skips it
  - Sync writes and workflow-derived column updates (e.g.,
    `ExperienceLocale.embedding`) skip revisioning
  - `revisedByKind`: `USER` | `AI` | `SYSTEM` (Prisma enum
    `RevisedByKind`)

  **Snapshot shape — write a versioned envelope, strip sensitive fields:**
  - Snapshots are stored as `{ v: 1, data: { ... } }` JSON. The version
    marker lets future schema migrations parse old snapshots leniently
    (`safeParse` with fallback) instead of failing rollback / diff views.
  - Service code MUST strip `embedding` (and any other derived /
    internal fields) from `data` before persisting. The embedding-
    exclusion test in `schema.test.ts` covers the GraphQL surface; the
    service layer must additionally never let an embedding vector land
    inside a revision snapshot.
  - Concurrent draft-create race: the partial unique
    `content_revision_one_draft_per_entity` enforces "one DRAFT per
    entity" at the DB level. The service must use `INSERT ... ON
CONFLICT` (Prisma `upsert`) or catch P2002 and retry as UPDATE,
    rather than letting the constraint violation surface raw.

  **Adding revisions to a new entity type (extensibility):**
  - No schema change. Pick the entity type string (e.g.
    `'experience_locale'`) and call the service-layer create/update
    helpers from any future service that mutates the entity.

  **Public reads** stay simple — read canonical filtered by
  `status=PUBLISHED`. Drafts never leak because they live in a separate
  table.

  **Approval workflow:** none in v1. Direct publish via existing
  `LocaleStatus` enum. Adds a `pending_review` status + reviewer
  assignment when the team actually asks for it.

- **`VideoSubtitle` attaches to `VideoEdition`, not to `Video`.**
  Timecodes derive from the edition's cut (a director's cut starts
  scenes at different timestamps than a theatrical cut), so subtitle
  alignment is an edition property. One unified entity covers all timed
  text tracks: source-language subtitle ≈ transcript, target-language
  subtitle = translation, same-language-as-dub subtitle ≈ closed
  caption. Semantics derive from `languageId` vs the dub's audio
  language at query time — no separate `Transcript` or `ClosedCaption`
  models.
- **Reference data** (Language, Country, Keyword, Continent,
  CountryLanguage, VideoOrigin, VideoEdition, MuxVideo, BibleBook) uses a
  single row with a `name` JSONB column keyed by locale — pragmatic for
  low-cardinality display-only localization.
- **Block schema** — Zod discriminated union in `src/domain/blocks.ts`
  with three scopes (top-level, section content, container-slot content)
  matching the 16 legacy CMS section components. `.strict()` rejects
  unknown keys; `quizButton` is scoped to `section.content`; section
  cannot contain another section. Adding a new block type is a single
  Zod schema + `t` literal + union entry — no Prisma migration required.
- **Pothos type classification** — every type carries
  `@classification abac-gated` or `@classification public-shape` JSDoc
  so Unit 6 can enforce the split-by-classification rule (abac-gated
  relations must route through a service resolver, not `t.relation`).

### Unit 3 spike — sign-off record (2026-04-13)

The architecture spike (Yoga + Pothos + Prisma plugin + scope-auth) was
verified against a live Postgres on 2026-04-13 and the go/no-go gate passed.

**Observed results against a seeded DB (2 Ping rows, 3 PingChild rows):**

- `{ pingAll { id message children { label } } }` with `x-spike-role: EDITOR`
  issued exactly two Prisma queries:
  1. `SELECT … FROM "public"."ping" ORDER BY "created_at" DESC`
  2. `SELECT … FROM "public"."ping_child" WHERE "ping_id" IN ($1,$2)`
     This is the batched IN-clause pattern the Pothos Prisma plugin uses for
     nested relations — no N+1.
- Unauthenticated `{ pingAll { id } }` rejected at the scope-auth layer
  before Prisma was invoked: `"Not authorized to resolve Query.pingAll"`.
- Unauthenticated `{ pingPublic(id: "p1") { ... } }` resolved to data for a
  Ping with `isPublic: true` (the `public: true` scope opts into anonymous
  access); the same query for `isPublic: false` returned `null` because the
  service's WHERE clause filtered it out.
- `fetchAPI: { Response }` streams correctly through Next App Router.

**Rerun the runbook (DB-dependent sign-off) any time the stack versions change:**

1. Start Postgres with pgvector extension available.
2. `pnpm --filter @forge/admin db:migrate:dev` — applies 0001_init + 0002_spike_ping.
3. Seed a Ping with ≥2 PingChild rows (Prisma Studio or psql).
4. Enable Prisma query logging (`NODE_ENV=development` already does this).
5. `pnpm --filter @forge/admin dev` and open `/api/graphql` in a browser.
6. Run this query with header `x-spike-role: EDITOR`:
   ```graphql
   query {
     pingAll {
       id
       message
       children {
         id
         label
       }
     }
   }
   ```
7. In server logs, count SQL statements: there should be at most TWO for
   the nested `children` resolution (one for the parent Ping, one JOINed
   or batched child lookup). Any higher count = Pothos `...query` is not
   being honored — STOP and re-evaluate before Unit 4.
8. Run the query WITHOUT the `x-spike-role` header: scope-auth must reject
   `pingAll` with an UNAUTHENTICATED-style error while `pingPublic(id)`
   still resolves for a Ping with `isPublic: true`.

Remove `Ping`/`PingChild` (schema + migration + graphql types + tests) in
the first Unit 4 commit after sign-off.

## Core sync — video-dubs phase

Admin owns the dub catalogue locally. The video-dubs sync phase
(`src/services/core-sync/phases/sync-dubs.ts`) writes Core's variants
into admin's `VideoDub` + `VideoDubDownload` + `VideoEdition` +
`MuxVideo` rows. Downstream embed enumeration (R1, R2) JOINs
`video_dub` to derive each video's dub-language set, so a partial dub
catalogue silently shrinks the embed target list — keep this phase
green.

- **Query shape:** flat top-level `videoVariants(offset, limit, input)`,
  not `videos { variants { … }}`. The nested form trips Core's resolver
  fan-out cliff on megavideos like JFP-Classic and aborts after ~50 s
  with `INTERNAL_SERVER_ERROR`. Both `since` (incremental) and full
  sync route through the same paginated loop; `since` populates
  `input: { updatedAt: { gte: since }}`, full passes `input: undefined`.
  See `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`.
- **PAGE_SIZE = 100.** Inside Core's per-call cost ceiling for the
  flat query. Probe data: `videos(limit:5)+variants` ok in 240 ms,
  `videos(limit:25)+variants+downloads` times out at 50.4 s. The flat
  `videoVariants(limit:N)` shape spreads megavideo variants across
  pages, so 100 is comfortable today; raise it once Core lands a `take`
  cap on `Video.variants`.
- **Per-page error isolation.** The page loop wraps `coreQuery` in
  try/catch. A failing page logs `core-sync.video-dub.page.error` (with
  `offset`, `pageSize`, and `error.message`), increments `stats.errors`,
  advances `offset`, and continues. One transient Core hiccup mid-
  pagination must NOT abort the rest of the phase.
- **Soft-delete via array-bound raw SQL.** When `!since &&
stats.errors === 0 && seenCoreIds.size > 0`, the phase soft-deletes
  Core-sourced rows missing from the seen set via:
  ```
  UPDATE "video_dub"
  SET    "deleted_at" = NOW()
  WHERE  "source"     = 'core'
    AND  "deleted_at" IS NULL
    AND  NOT ("core_id" = ANY(${toPgArray([...seenCoreIds])}::text[]))
  ```
  Note: `'core'` is the lowercase DB enum value (`SourceTier ENUM('core',
  'manager')` from `0001_init`). Prisma's TS enum maps `CORE` → `'core'`
  automatically; raw SQL bypasses that mapping so the literal must match
  the DB value.
  NOT `prisma.videoDub.updateMany({ coreId: { notIn: [...] }})` — that
  generates one prepared-statement parameter per ID and Postgres caps
  prepared-statement params at 32,767 (`PG_INT16_MAX`). The 209k-row
  catalogue blew past the cap. The array-literal-as-text pattern keeps
  the parameter count at 1 regardless of catalogue size; per
  `apps/admin/src/db/pgvector.ts::toPgArray()` and the PG18 cast note
  in root `CLAUDE.md`.
- **Soft-delete safety:** the gating expression `!since && stats.errors
=== 0` means a partial seen-set (one or more page errors) NEVER
  triggers mass soft-delete. The phase silently records the in-flight
  errors and leaves Core-sourced rows alone for the next full sync to
  reconcile.

**Operational runbook:**

1. `pnpm --filter @forge/admin core-sync:run --full --scope=video-dubs`
   from a workstation with `DATABASE_URL` pointed at a target Postgres.
   Local destinations are safe; prod requires the usual operator
   discipline (`run-sync.ts` posture — there is no in-script prod-URL
   guard).
2. Expect ~30-40 min on a fresh DB at the current catalogue size; ~85%
   of wall time is variants of JFP-Classic-class megavideos. Per-page
   logging is silent on the happy path; failure events are JSON
   structured for easy filtering.
3. Re-run is idempotent and safe. Each re-run re-walks every page; row
   writes upsert-on-conflict; soft-delete is gated on zero page errors
   so a partial run never decimates the catalogue.

**Common pitfalls:**

- Re-introducing the nested `videos { variants { … }}` query shape
  (e.g., as a "we only need a few videos" optimisation). Don't — the
  same Core-side timeout will trip and a single megavideo in the
  batch aborts the whole call. Use the flat `videoVariants` query
  with a `where` filter on `videoId` if scoping is genuinely needed.
- Replacing the soft-delete `$executeRaw` with `prisma.videoDub
.updateMany({ coreId: { notIn: [...] }})` for stylistic reasons.
  Don't — the bind-variable cap re-asserts immediately. The test in
  `sync-dubs.test.ts` is a regression guard.
- Lowering `PAGE_SIZE` to "make it safer." It does not. The cost
  ceiling is set by Core's resolver, not by per-page network cost on
  our side. Use the diagnostic probe in
  `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`
  to re-measure before changing the value.

## Scene embeddings (R1 of admin migration playbook)

Admin owns scene-level embeddings in its own Postgres. Source data is
apps/manager's `{assetId}/scene-analysis.json` S3 artifact (the
multimodal scene-analysis pipeline). Admin re-indexes those artifacts
into `VideoScene` + `VideoSceneLocale` and regenerates embedding
vectors using admin's embedding provider. Vectors are NOT copied from
cms; they're regenerated from the same model (`text-embedding-3-small`,
1536d). Total regeneration cost is well under $0.01 at current catalog
scale.

- **Schema:** `VideoScene` attaches to `VideoEdition` (timecodes follow
  the edition's cut, matching `VideoSubtitle`). Per-locale descriptions
  - embeddings live on `VideoSceneLocale`. `embedding` is
    `Unsupported("vector(1536)")?` and NEVER exposed via GraphQL
    (enforced by `schema.test.ts` "no embed/vector/similarit" assertion).
- **Partial HNSW indexes** per-locale (`en`, `es`, `fr`) plus a global
  NULL-excluded fallback. Per-locale indexes guard against the pgvector
  "HNSW + WHERE locale = ?" planner bypass.
- **Indexer service:** `src/services/scene-embedding.service.ts`
  (`indexEditionScenes`). Idempotent upsert on
  `(videoEditionId, sceneIndex)` and `(videoSceneId, locale)`. Raw SQL
  `::vector` write inside a Prisma `$transaction`. ABAC-gated via
  `canWriteDerived`.
- **Backfill workflow:**
  `src/workflows/sceneEmbeddingBackfill.ts` — useworkflow job that
  enumerates one target per `(video, edition, bcp47)` triple. The
  locale set is data-derived at enumeration time from the union of
  each video's primary language + edition-level subtitle languages +
  edition-level dub languages. No hardcoded locale list — an earlier
  prototype used `DEFAULT_LOCALES = ["en", "es", "fr"]`; dropped per
  `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`.
  Per-target error isolation; `artifact_missing` errors skip, provider
  errors fail but don't halt the run. Safe to re-run.
- **Bounded parallelism:** the per-target loop uses
  `pLimit(env.SCENE_EMBEDDING_CONCURRENCY ?? 10) +
Promise.allSettled` — never bare `Promise.all` (one rejection
  would abort the batch). See
  `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`.
  Outcome ordering follows `allSettled` resolution order, NOT the
  enumeration order; downstream code that walks `outcomes` by index
  is reading an undocumented contract. Tune via the
  `SCENE_EMBEDDING_CONCURRENCY` env var on `forge-admin` Doppler
  (start prod at `5`, ramp after observation; local can crank to
  `20+`).
- **Trigger:** `triggerSceneEmbeddingBackfill` GraphQL mutation
  (ADMIN-only; permission key `write:scene-embeddings`).

**Operational runbook:**

1. Refresh the coreId → cms video id mapping into admin's own Railway
   S3 bucket (the one wired to `RAILWAY_S3_*`):
   `pnpm --filter @forge/admin refresh:core-id-mapping`. The CLI
   dumps from cms and uploads to
   `admin-migrations/core-id-mapping.json`. Re-run when cms's catalog
   grows (Strapi SERIAL ids don't change, so existing entries stay
   valid).
2. Ensure both S3 env blocks are set on the `forge-admin` Railway
   service:
   - `RAILWAY_S3_*` → admin's write bucket
     (`cms-storage-jbpuckp0lmqap`, Railway bucket resource
     `17368fd5-23e7-45bb-b007-e3f843b3d710`). Used for the coreId
     mapping snapshot and any other `admin-migrations/*` writes.
   - `MANAGER_ARTIFACTS_S3_*` → manager's bucket
     (`forgemanagerartifacts-xtgld8`, Railway bucket resource
     `b1c705c6-5add-48a0-a153-5ef40f876a4f`). Read-only;
     `{assetId}/scene-analysis.json` + `{assetId}/embeddings.json`.

   Also ensure `OPENROUTER_API_KEY` or `OPENAI_API_KEY` is set so
   admin can re-embed scene descriptions.

3. Invoke `triggerSceneEmbeddingBackfill` via GraphQL. `mappingS3Key`
   defaults to `admin-migrations/core-id-mapping.json`; override for
   dry runs or ad-hoc snapshots. Omitted `locales` means "every
   locale that exists for the videos" (union of primary / subtitle /
   dub languages per edition). Restrict with `coreIds` or `locales`
   (strict inclusion list — no silent fallback).
4. Verify: `SELECT COUNT(*) FROM video_scene_locale WHERE embedding IS NOT NULL`
   grows as expected; `SELECT DISTINCT video_edition_id FROM video_scene`
   enumerates the indexed editions.

The primary learnings doc is
`docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`.

## Transcript embeddings (R2 of admin migration playbook)

Admin owns chunk-level transcript embeddings in its own Postgres.
Source data is apps/manager's `{assetId}/embeddings.json` S3 artifact
(the transcript embeddings pipeline). Admin re-indexes those artifacts
into `VideoTranscript` + `VideoTranscriptChunk`.

**R2 divergence from R1:** manager's `embeddings.json` already contains
vectors per chunk (`EmbeddingsResult.chunks[].embedding`), so admin
REUSES the vectors verbatim rather than regenerating. Zero OpenRouter
spend on R2 backfill. Admin validates `dimensions === 1536` (hard
reject as `dimension_mismatch`) and logs a warning on model-stamp
drift (proceeds anyway — the point of vector reuse is to trust
manager's stamp). See
`docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`.

- **Schema:** `VideoTranscript` attaches to `VideoEdition` (same cut-
  aware attachment as `VideoSubtitle` / `VideoScene`). One row per
  `(editionId, language)` carries artifact-level metadata (model,
  dimensions, chunking strategy, generatedAt, totalChunks, totalTokens).
  Per-chunk rows on `VideoTranscriptChunk` carry text + timecodes +
  `embedding Unsupported("vector(1536)")?`. `language` is denormalized
  onto the chunk for partial HNSW filtering.
  `embedding` is NEVER exposed via GraphQL (enforced by
  `schema.test.ts` "no embed/vector/similarit" assertion; client
  extension in `src/db/client.ts` strips it from default result sets).
- **Partial HNSW indexes** per-language (`en`, `es`, `fr`) plus a
  global NULL-excluded fallback. Same rationale as R1.
- **Indexer service:** `src/services/transcript-embedding.service.ts`
  (`indexEditionTranscript`). Idempotent upsert on `(editionId, language)`
  for the parent and `(transcriptId, chunkIndex)` for chunks. Pre-
  transaction prune removes stale chunks when manager re-chunks with
  fewer segments. Raw SQL `::vector` write inside a Prisma
  `$transaction` with explicit 30s timeout. ABAC-gated via
  `canWriteDerived`.
- **Backfill workflow:**
  `src/workflows/transcriptEmbeddingBackfill.ts` — useworkflow job
  that enumerates one target per `(video, edition, bcp47)` triple.
  The language set is data-derived at enumeration time from the
  union of each video's primary language + edition-level subtitle
  languages + edition-level dub languages. No hardcoded language
  list, no `en` fallback — if a video has no language attestation
  anywhere, it produces no targets (a data-quality signal, not a
  silent default). Per-target error isolation; `artifact_missing`
  → skipped, every other error → failed but the run continues.
  Safe to re-run.
- **Bounded parallelism:** the per-target loop uses
  `pLimit(env.TRANSCRIPT_EMBEDDING_CONCURRENCY ?? 10) +
Promise.allSettled` — never bare `Promise.all`. Same shape /
  same rule as R1; tune via the `TRANSCRIPT_EMBEDDING_CONCURRENCY`
  env var. R2 is DB-bound (no provider call) so the bottleneck on
  cranking concurrency is Postgres connection saturation, not
  upstream rate limits.
- **Trigger:** `triggerTranscriptEmbeddingBackfill` GraphQL mutation
  (ADMIN-only; permission key `write:transcript-embeddings`).

**Operational runbook** (shares the R1 mapping snapshot):

1. Refresh the coreId → cms video id mapping into admin's own Railway
   S3 bucket (the one wired to `RAILWAY_S3_*`):
   `pnpm --filter @forge/admin refresh:core-id-mapping`.
   Same CLI R1 uses; same snapshot consumed by both workflows.
2. No API keys required for R2 backfill (vectors come from the
   artifact). `RAILWAY_S3_*` (admin's own write bucket — used by the
   refresh CLI for `admin-migrations/core-id-mapping.json`),
   `MANAGER_ARTIFACTS_S3_*` (manager's bucket — where admin reads
   `{assetId}/embeddings.json` and `{assetId}/scene-analysis.json`
   from), and `REDIS_*` must be set on the `forge-admin` Railway
   service. The two S3 env blocks point at _different_ buckets — see
   `src/storage/s3.ts` for the split.
3. Invoke `triggerTranscriptEmbeddingBackfill` via GraphQL.
   `mappingS3Key` defaults to `admin-migrations/core-id-mapping.json`.
   Omitted `languages` means "every BCP-47 that exists across the
   corpus" (union of primary / subtitle / dub languages per edition).
   Restrict with `coreIds` (filter by video) or `languages` (strict
   inclusion list — no silent fallback). Today manager writes one
   embeddings.json per asset, so multi-language editions produce
   multiple transcript rows with identical chunk text/vectors under
   different language stamps; the schema is future-ready for
   per-language artifacts manager will produce later.
4. Verify:
   `SELECT COUNT(*) FROM video_transcript_chunk WHERE embedding IS NOT NULL`
   grows as expected;
   `SELECT DISTINCT video_edition_id FROM video_transcript`
   enumerates the indexed editions.

The primary learnings doc is
`docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`.

## Experience content dump (R3 of admin migration playbook)

Admin owns the per-locale Experience corpus and re-derives it from
cms's Strapi v5 `experiences` table on each rerun of the
`triggerExperienceContentDump` mutation. cms remains the editor
surface and consumer-facing renderer until R8 cutover; admin's
corpus is a refreshed mirror with one tolerance — admin-side
`ContentRevision` rows survive reruns because they live in a
separate table the dump never touches.

- **Schema:** three nullable columns on `ExperienceLocale`:
  `cms_document_id` (Strapi v5's cross-locale + cross-publish-state
  grouping key), `cms_dumped_at` (last touched by the dump),
  `cms_content_hash` (SHA-256 hex over the canonical-JSON merge
  payload — gates both rerun-skip and `runExperienceEmbedding`
  re-dispatch). Partial index on `cms_document_id WHERE NOT NULL`.
  None of the three is exposed via GraphQL (defense-in-depth:
  `schema.test.ts` asserts no `cms_*hash | cms_*document_*id |
cms_*dumped_*at`-shaped field leaks).
- **cms connection:** lazy singleton `pg.Pool` in
  `src/db/cms-pg.ts` against `CMS_DATABASE_URL`. Optional at boot
  so admin still starts in environments without the dump enabled.
  When the workflow runs without the env set, `getCmsPgPool()`
  throws `CmsDatabaseUrlMissingError` AT THE WORKFLOW BOUNDARY
  (before target enumeration), surfacing as a top-level GraphQL
  error rather than a per-target outcome. Operators see a clean
  `ExperienceContentDumpError`-style failure with the env-name in
  the message — the dispatch never charges any target. Statement
  timeout is set to 15s at the connection level so a stuck cms
  query cannot hang the workflow.
- **Repository:** `src/services/cms-experience-source.repository.ts`
  reads Strapi v5 schema verbatim (snake_case row shapes mirror cms
  PG columns). Table names from a hardcoded allowlist so a typo or
  attacker-influenced `component_type` cannot reference an arbitrary
  table. An in-memory fake (`cms-experience-source.fake.ts`) is the
  test surface for service-level tests.
- **Block transformers:** `src/services/cms-block-transforms.ts` —
  one transformer per Strapi component UID + recursion through
  section/container nested zones. Each transformer constructs the
  admin shape from scratch (no spread of cms attrs), normalises
  null/empty cms strings to undefined for Zod optionality, and
  dispatches a `BlockTransformError` (typed code + componentType +
  cmpId) on required-field violations. Error messages NEVER echo
  cms row data (cf. `zod-validation-errors-must-not-echo-user-controlled-input-20260420.md`).
- **Indexer service:** `src/services/experience-content-dump.service.ts`
  (`dumpExperienceLocale`). Per-locale flow: ABAC gate → load source
  row preferring published → load components → resolve cms video
  ids → transform → Zod parse → resolve experience-level ogImage URL
  → SHA-256 hash → upsert in `$transaction` (locale row + snapshot
  columns). Hash is NOT persisted by the service — the workflow
  writes it after embed dispatch succeeds (so a failed dispatch
  leaves the previous hash in place and the next rerun retries).
- **Backfill workflow:**
  `src/workflows/experienceContentDump.ts` — useworkflow job that
  enumerates one target per `(document_id, locale)` from cms,
  filters out `locale = NULL` rows, dispatches the dump service
  per-target, and dispatches `runExperienceEmbedding` for outcomes
  with `action !== "skipped_unchanged"`. Per-target error
  isolation; `Promise.allSettled` not used — sequential `for…of`
  per-target matches R1/R2.
- **Trigger:** `triggerExperienceContentDump` GraphQL mutation
  (ADMIN-only; permission key `write:experience-content-dump`).
  JSON return shape parity with R1/R2: `{ totalTargets,
documentIdFilter, localeFilter, outcomes, succeeded, skipped,
failed, embedsDispatched }`. Per-target outcome is a discriminated
  union: `succeeded { action: "created" | "updated" |
"skipped_unchanged", embedDispatched, draftPendingNewer,
videoResolutionMisses, ... }` or `failed { reason: "forbidden" |
"null_locale" | "slug_collision" | "failed_validation" |
"embed_dispatch_failed" | "cms_read" | "db_write" | "unknown",
message, ... }`.

**Operational runbook:**

1. **Provision a read-only Postgres role on cms** (out-of-band,
   platform team owned). Grant `SELECT` on the experience-related
   tables only:
   - `experiences`, `experiences_cmps`
   - all `components_sections_*` tables (17 component row tables +
     5 nested `_cmps` join tables)
   - `files`, `files_related_mph`
   - `videos` (for cms video id → coreId resolution)
   - The four `_video_lnk` join tables that carry component →
     video relations
2. **Set `CMS_DATABASE_URL` on the `forge-admin` Doppler project**
   (`forge-admin` env). Format: `postgres://forge_admin_readonly:<pw>@<host>:<port>/<db>?sslmode=require`.
   Until this lands, `triggerExperienceContentDump` invocations
   throw `CmsDatabaseUrlMissingError` cleanly.
3. **Invoke the mutation via GraphQL.** Both args are optional:
   ```graphql
   mutation {
     triggerExperienceContentDump(documentIds: ["…"], locales: ["en"])
   }
   ```
   Omitted args = "every cms experience document" / "every locale
   that exists in cms's experiences corpus" (data-derived at
   enumeration time).
4. **Verify:**
   - `SELECT COUNT(DISTINCT cms_document_id) FROM experience_locale
WHERE cms_document_id IS NOT NULL` — number of cms
     documents now mirrored in admin.
   - `SELECT COUNT(*) FROM experience_locale WHERE cms_dumped_at IS
NOT NULL` — number of locale rows the dump touched.
   - `SELECT COUNT(*) FROM experience_locale WHERE status='PUBLISHED'
AND embedding IS NOT NULL` — published locales with a vector
     (downstream of `runExperienceEmbedding` workflow completion).

**Common things to remember:**

- cms is canonical for content during the R3→R8 window; admin
  reruns are merge-aware. Don't try to fix dump-overwrite issues by
  hand-editing admin rows — the next rerun will revert them. The
  exception is `ContentRevision` DRAFTs, which the dump explicitly
  doesn't touch.
- The workflow body uses sequential `for…of`, NOT `Promise.all`.
  Cf. `parallel-workflow-error-robustness-20260420.md`.
- Every `start()` call site has a dispatch-level test (cf.
  `workflow-dispatch-test-mode-divergence-20260421.md`). The
  mutation→workflow dispatch lives in
  `src/graphql/mutations/experience-content-dump.test.ts`; the
  workflow→`runExperienceEmbedding` dispatch lives in
  `src/workflows/experienceContentDump.test.ts`.
- Locale enumeration is data-derived from cms's actual `locale`
  column; no hardcoded list, no `en` fallback (cf.
  `prototype-defaults-vs-data-derived-enumeration-20260422.md`).

The primary learnings doc is
`docs/solutions/platform/admin-experience-content-dump-pattern.md`.

## Hybrid search (R4 of admin migration playbook)

Admin owns public hybrid search — semantic + keyword retrieval fused via
Reciprocal Rank Fusion — over the `Video`/`VideoLocale`/`VideoScene[Locale]`
and `Experience`/`ExperienceLocale` corpora. Matches the contract of
apps/cms `/api/search` + `/api/search/health` byte-for-byte (modulo
cuid-string ids) so apps/web + apps/mobile can swap base URL at R8
cutover with zero response-shape drift.

- **Shared service:** `src/services/hybrid-search.service.ts`
  (`HybridSearchService`). One `search(params)` entry point called by
  both the REST handler and the GraphQL resolver. Constants verbatim
  from cms: `RRF_K = 60`, `OVERFETCH_FACTOR = 3`, `DEFAULT_LIMIT = 20`,
  `MAX_LIMIT = 50`.
- **Retrievers:** `src/services/hybrid-search-retrievers.ts` exports
  four functions. Each is a thin `$queryRaw` caller.
  - `searchVideoSemantic` — pgvector cosine over `VideoSceneLocale.embedding`,
    `DISTINCT ON (video_scene.video_id)`, locale-filtered. Resolves
    `playbackId` via a LATERAL lookup on `video_dub → mux_video` keyed
    by `(video_edition_id, language.bcp47 = locale)`. When no dub
    matches, playbackId is NULL and the row still returns.
  - `searchVideoKeyword` — tsvector over `VideoLocale.title +
description`, same `'simple'` config as cms, locale + status gate.
  - `searchExperienceSemantic` — pgvector cosine over
    `ExperienceLocale.embedding` joined to non-archived Experience.
    `resultId` is `ExperienceLocale.id` (per-locale), not the parent
    Experience.id — admin's per-locale model makes the locale row the
    natural identity.
  - `searchExperienceKeyword` — tsvector over `ExperienceLocale.title
    - meta_description`.
- **GIN index byte-parity invariant:** the tsvector expressions live in
  `src/services/hybrid-search-sql.ts` as TypeScript string constants.
  The migration at `prisma/migrations/0006_hybrid_search_gin/migration.sql`
  uses the exact same expressions. A `hybrid-search-sql.test.ts` unit
  test reads the migration file and asserts byte-equality — silently
  drifting one but not the other reverts the query to Seq Scan.
- **Fusion + dedup:** `src/services/hybrid-search-fusion.ts` — RRF
  (`fuseRankedLists`) + 3-layer video dedup (`deduplicateResults`:
  coreId prefix, exact title, embedding cosine > 0.95) +
  `cosineSimilarityFromText`. Line-for-line port of cms's `fusion.ts`
  with `resultId: string` (admin cuids) instead of cms's integer ids.
  Experience rows skip all three dedup layers.
- **Scene-only for video-semantic in R4.** `VideoTranscriptChunk.embedding`
  (R2-indexed) is deliberately NOT fused. Strict cms parity during the
  R3→R8 window; adding a 5th RRF list for transcripts is a post-cutover
  follow-up that won't change the consumer contract.
- **Experience imageUrl is null in R4.** cms parity. `ExperienceLocale.ogImageUrl`
  exists on admin but wiring it is a deliberate post-cutover upgrade
  so the pre-R8 diff-against-cms invariant holds.
- **Degradation signal:** `searchMode: "hybrid" | "keyword-only"`. Set
  to `"keyword-only"` when the embedding provider throws. Structured
  log at error level: `[search] event=query_embedding_failure
error_class=… message=…`. Process-local counters in
  `src/services/hybrid-search-health.ts`.
- **Embedding provider:** reuses
  `generateExperienceEmbedding(text)` from
  `src/services/embeddings.service.ts` verbatim. Name is historical
  (it takes a plain string); renaming is a follow-up outside R4 scope.
- **REST endpoints** — Next App Router route handlers. First such
  endpoints in admin outside of `/api/auth` and `/api/graphql`.
  - `GET /api/search` at `src/app/api/search/route.ts` — query params
    `q` (required, trimmed), `locale` (required), `type` (optional
    enum), `limit`, `offset`. 400 on missing/invalid; 429 on
    rate-limit; 503 on unexpected service throw.
  - `GET /api/search/health` at `src/app/api/search/health/route.ts` —
    synthetic probe that runs a real `embedQuery("health probe")` with
    a 5s timeout. Always HTTP 200; body's `status` field is the
    machine-readable signal. Shared counters with the search
    orchestrator.
  - Rate limiting via `rateLimitAuthRoute` from `src/auth/rate-limit.ts`
    (same Redis-backed limiter used by `/api/auth`). Distinct `route`
    keys: `"search"` (30/min) and `"search-health"` (5/min) so probe
    traffic never starves the user quota.
- **GraphQL:** public `search(q, locale, type, limit, offset)` query
  at `src/graphql/queries/hybrid-search.ts`. `authScopes: { public: true }`.
  Returns `HybridSearchResponse` → `HybridSearchResult` with fields
  matching the REST JSON 1:1. `schema.test.ts` asserts the new types
  expose no `embedding|vector|similarit`-shaped field.
- **`embedding::text` transport in semantic-video SQL** is
  service-internal — it feeds the 3-layer dedup's cosine-similarity
  check. The Pothos schema never exposes it, so the GraphQL-surface
  leak guard in `schema.test.ts` still passes.

**Operational runbook:**

1. Point external monitors (Railway healthcheck, uptime tools) at
   `https://admin.jesusfilm.org/api/search/health`. Body's `status`
   field is the signal; HTTP is always 200 so infra-level liveness is
   not confused with provider reachability.
2. Ensure `OPENROUTER_API_KEY` or `OPENAI_API_KEY` is set on the
   `forge-admin` Railway service (already required by R1–R3).
3. Canary diff vs cms: for a fixed query set × locales, compare
   `admin/api/search?q=…&locale=…` to `cms/api/search?q=…&locale=…`.
   Top-10 should overlap within ranking ±1. Drift signals either a
   data-readiness gap (R1 scene backfill not yet run on prod) or an
   SQL-invariant drift to investigate.
4. Verify GIN indexes are used:
   `EXPLAIN ANALYZE SELECT COUNT(*) FROM video_locale WHERE
to_tsvector('simple', coalesce(title,'') || ' ' ||
coalesce(description,'')) @@ plainto_tsquery('simple', 'jesus');`
   should show `Bitmap Index Scan on video_locale_fulltext_search_idx`.

**Common things to remember:**

- R4 is a READ-SIDE port. No useworkflow dispatch, so no
  dispatch-level test obligation (cf.
  `workflow-dispatch-test-mode-divergence-20260421.md` — applies to
  backfill shapes, not synchronous reads).
- Every SQL invariant was re-derived from admin's schema (cf.
  `dead-invariant-checks-from-sibling-port-20260422.md`): cms's
  `videos.title` → admin's `video_locale.title`, cms's
  `video_variants` publish chain → admin's `VideoLocale.status +
Video.deleted_at`, cms's scene_embeddings single-row → admin's
  VideoSceneLocale per-locale.
- Data-derived enumeration (cf.
  `prototype-defaults-vs-data-derived-enumeration-20260422.md`): no
  hardcoded locale list. `locale` is required at the boundary;
  zero-result responses on a locale with no corpus are legitimate
  data signals.

The primary learnings doc is
`docs/solutions/platform/admin-hybrid-search-r4-pattern.md`.

Note: the 3-layer video dedup + `cosineSimilarityFromText` live in
`src/services/video-dedup.ts` as of R5 so hybrid search and scene
recommendations consume one implementation. `deduplicateResults` below
is a thin `FusedResult`-typed wrapper.

## Hybrid search keyword-first mode (R4 extension)

Opt-in `mode="keyword-first"` argument on the same `HybridSearchService`
that R4 ships. Adds three lexical retrievers + a post-fusion semantic-
dilution cap + an origin-gated debug payload. Default behavior stays
byte-identical to R4 main when `mode` is unset / null / `""` / `"hybrid"`
/ unknown — locked in by `src/services/hybrid-search.regression.test.ts`.

This is an **extension of R4**, not a new R-stage. The cms-side
`feat-109` work (apps/cms PR #852) lives on cms during the R3 → R8
window; admin's surface matches the cms-side contract by R8 cutover.

- **Schema:** Migration `0009_keyword_first_lexical/migration.sql`
  originally provisioned `pg_trgm`, two STORED generated tsvector
  columns on `video_locale` (`title_tsv`, `description_tsv`), a
  weighted GIN index over `(setweight(title_tsv,'A') ||
setweight(description_tsv,'B'))`, and a trigram GIN index on
  `title gin_trgm_ops`. Migration
  `0010_camelcase_tsv_and_description_trigram` then DROP-CASCADEd
  the generated columns and recreated them with a CamelCase-split
  `regexp_replace` wrapper before `to_tsvector` (so `BibleProject`
  tokenizes as `bible` + `project`, not just `bibleproject`),
  recreated the weighted GIN index, and added a second trigram GIN
  index on `description gin_trgm_ops`. **As of 0010:** generated
  columns are owned by 0010, the title trigram index from 0009 is
  untouched, and there are now TWO trigram indexes
  (`video_locale_title_trgm_idx`, `video_locale_description_trgm_idx`).
  Generated columns + GIN indexes attach to `VideoLocale`, NOT
  `Video` (per-locale attachment per admin's data model). The legacy
  R4 `video_locale_fulltext_search_idx` from `0006` is untouched —
  hybrid mode keeps reading it via `searchVideoKeyword`, which is
  why hybrid mode stays byte-identical to R4 even after 0010
  changed the keyword-first tokenization. See
  `docs/plans/2026-05-02-001-fix-keyword-first-camelcase-recall-plan.md`.

- **Byte-parity invariant:** `WEIGHTED_TSV_INDEX_EXPR` /
  `WEIGHTED_TSV_QUERY_EXPR` / `TITLE_TSV_GENERATED_EXPR` /
  `DESCRIPTION_TSV_GENERATED_EXPR` in `src/services/hybrid-search-sql.ts`
  must stay byte-equal to the migration. `hybrid-search-sql.test.ts`
  reads the migration and asserts. The trigram path uses operator-class
  GIN (`gin_trgm_ops`) — no expression byte-parity guard needed; index
  selection happens via the `%>` operator. Per
  `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`.

- **Generated-column drift trap:** Postgres has no `ALTER COLUMN ...
GENERATED` editor for stored expressions. Any future rewrite of
  `*_GENERATED_EXPR` requires a coordinated `DROP COLUMN ... CASCADE +
ADD COLUMN ... GENERATED ALWAYS AS (...)` migration. Per
  `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`.

- **Three new lexical retrievers** in
  `src/services/hybrid-search-keyword-first-retrievers.ts`:
  - `searchByKeywordWeighted` — phrase-aware
    `websearch_to_tsquery('simple', q)`, ranked by `ts_rank_cd`
    against the weighted tsvector. `Prisma.raw(WEIGHTED_TSV_QUERY_EXPR)`
    for the unbindable expression fragment.
  - `searchByTrigram` — `vl.title %> q OR vl.description %> q`
    with ranking by
    `GREATEST(similarity(vl.title, q), similarity(coalesce(vl.description, ''), q))`.
    Per-row dedup via `DISTINCT ON (v.id)` collapses rows that match
    via both fields. Backed by `video_locale_title_trgm_idx` (from 0009) and `video_locale_description_trgm_idx` (from 0010). The
    description-side index is heavier than the title-side; current
    catalog is 0 rows in prod, so the precaution that gated R4 on
    title-only no longer applies — but capture
    `pg_relation_size('video_locale_description_trgm_idx')` once R0
    backfill lands and revisit if it grows beyond a few hundred MB.
  - `searchByExactTitle` — dynamic AND-chain of `vl.title ILIKE ?`
    via `Prisma.join`, ranked `LENGTH(title) ASC`. Tokenization is
    Unicode letter / digit split, lowercased, deduped, **capped at
    `MAX_EXACT_TITLE_TOKENS = 16`** (DoS guard from cms-side fix).
    All three honor R4's locale + status + `deleted_at IS NULL` chain.

- **Branched orchestrator:** Single `HybridSearchService.search()`
  branches once on `pipelineMode === "keyword-first"`. Hybrid path
  is UNTOUCHED. Keyword-first dispatches: semantic-video (shared) +
  keyword-weighted-video + trigram-video + exact-title-video. The
  R4 `searchVideoKeyword` is NOT called on the keyword-first branch.
  Per `docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md`.

- **Mode normalization:** `normalizeMode(raw, logger)` decodes the
  free-form public arg to a closed `SearchPipelineMode` set. Unknown
  values warn-and-fall-back to hybrid via a single sanitized log line
  (`[search] event=search_unknown_mode mode=… falling_back=hybrid`)
  — never throws. CR/LF/TAB stripped, length clamped to 64. Per
  `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md`.

- **Semantic-dilution cap:** Active only in keyword-first mode and
  only when at least one exact-title result's lowercased title
  contains every query token. When triggered, semantic-only fused
  results whose `videoCoreId` is null OR not present in the top-3
  keyword-side core_ids get `score *= 0.5` and the list re-sorts.
  `applyDilutionCap` is exported for unit testing. Gated by
  `SEARCH_DILUTION_CAP_ENABLED` (default `true`; only literal
  `"false"` disables — tolerant parser is a documented follow-up).

- **Origin-gated `debug` payload:** `isDebugAllowedForOrigin` in
  `src/services/hybrid-search-debug-allowlist.ts` is the soft gate.
  Boundary (REST + GraphQL) consults the allowlist; the service
  trusts the boolean. Fail-closed on `Origin: undefined`. Allowlist:
  `SEARCH_DEBUG_ALLOWED_ORIGINS` CSV; otherwise any origin in
  non-production. Threat model is "soft feature flag, not auth" —
  Origin headers are forgeable from non-browser clients. The payload
  carries no PII / credentials, only retriever ranks + fused score
  - cap state. Per
    `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`.

- **GraphQL types:** `HybridSearchResult.debug` is a nullable
  `HybridSearchResultDebug` (`retrieverRanks`, `fusedScore`,
  `dilutionCapApplied`). `HybridSearchRetrieverRank.label` is
  explicitly **UNSTABLE** in the schema description — operators
  inspecting payloads are the audience; do NOT branch on those
  strings in production code. `schema.test.ts` asserts no
  `embed|vector|similarit` field leaks on either new type.

- **REST endpoint:** Same `GET /api/search` extends with `mode` +
  `debug` query params. `mode=` (empty) is forwarded as undefined to
  avoid polluting the warn log. `debug=true` is the only opt-in
  spelling — `debug=1` and other truthy values are treated as off
  (debug is a deliberate developer affordance, not a fuzzy toggle).

- **Endpoints + acceptance:**
  - `GET /api/search?q=…&locale=…&mode=keyword-first&debug=true`
  - GraphQL: `Query.search(q, locale, type?, limit?, offset?, mode?, debug?)`
  - Bible Project headline test
    (`src/services/hybrid-search.bible-project.test.ts`) asserts top-3
    are all `/bible\s*project/i` titles for `q="the bible project"`.

- **Test-first regression gate:**
  `src/services/hybrid-search.regression.test.ts` asserts byte-identity
  across `mode ∈ {undefined, null, "", "hybrid", "garbage"}` against
  deterministic mocked retrievers. Adding a new retriever / debug
  field / cap parameter is allowed only as long as that test stays
  green. Per
  `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`.

**Operational runbook:**

1. Apply migrations `0009_keyword_first_lexical` and
   `0010_camelcase_tsv_and_description_trigram` in any environment
   that wants keyword-first available. `prisma migrate dev` /
   `prisma migrate deploy` is idempotent against `_prisma_migrations`.
   **Re-applying 0010 manually against a populated `video_locale` is
   destructive** — DROP CASCADE removes the columns and the rebuild
   takes AccessExclusiveLock. Treat fixes as forward-only
   counter-migrations, never `migrate resolve --rolled-back` 0010
   once R0 has populated the table. The three GIN indexes
   (weighted, title trgm, description trgm) add disk + write
   amplification proportional to corpus size; cost is negligible at
   admin's current zero-row prod data and grows when R0 backfills.
2. Confirm `pg_trgm` extension permission on the prod DB role.
   First migration that needs it; older R0–R5 migrations don't.
3. To opt in via REST, append `?mode=keyword-first`. To opt in via
   GraphQL, pass `mode: "keyword-first"`. Default behavior is
   byte-identical to R4.
4. To inspect scoring on a dev / preview environment: append
   `&debug=true` AND make the request from an allowlisted origin
   (any origin in non-production by default; explicit
   `SEARCH_DEBUG_ALLOWED_ORIGINS` CSV overrides). Curl needs an
   explicit `-H "Origin: <allowlisted>"` header.
5. Verify GIN indexes are used. Probe SQL:
   `EXPLAIN ANALYZE SELECT v.id FROM video_locale vl JOIN video v ON
v.id = vl.video_id WHERE setweight(vl.title_tsv,'A') ||
setweight(vl.description_tsv,'B') @@
websearch_to_tsquery('simple', 'jesus') AND vl.locale = 'en'
LIMIT 10;`
   should show `Bitmap Index Scan on
video_locale_lexical_weighted_idx`. Trigram probe (post-0010, both
   title and description halves should appear in the plan via
   `BitmapOr`):
   `… WHERE (vl.title %> 'jesus' OR vl.description %> 'jesus') …`
   should show `BitmapOr` over `video_locale_title_trgm_idx` and
   `video_locale_description_trgm_idx`. On an empty corpus the
   planner correctly prefers Seq Scan; the BitmapOr plan only
   matters once data lands. Re-run this probe at R0 readiness.
6. R0 dependency: admin's `video` / `video_locale` tables are 0 rows
   in prod. Real-DB integration tests (canary diff vs cms keyword-first,
   EXPLAIN-based GIN verification) are deferred to R0 readiness.

**Common things to remember:**

- The hybrid path is byte-identical to R4. Touching it without
  updating `hybrid-search.regression.test.ts` is the definition of a
  regression. Per `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`.
- `searchMode` (response field) ≠ `mode` (input arg). The response
  reports embedding-degradation; the input selects the pipeline.
  GraphQL schema description on `Query.search.mode` explicitly
  disambiguates.
- Retriever labels in the debug payload are UNSTABLE — never branch
  on them in production code.
- `Prisma.raw(EXPR)` is reserved for the unbindable weighted tsvector
  fragment. Bound parameters interpolate via `${expr}` in the
  template literal. `searchByExactTitle` uses `Prisma.join` to
  compose the variable-length AND-chain so the placeholder count
  always matches the bound-value count (Postgres rejects unbound
  placeholders at parse time, which is the safe failure mode).
- The dilution cap is invisible on thematic queries
  (`q="hope when life is hard"`) — those have no exact-title trigger,
  so the cap silently does nothing. Hard filtering is intentionally
  NOT used.

The primary learnings doc is
`docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`.

## Scene recommendations (R5 of admin migration playbook)

Admin owns public scene-similarity recommendations — given a seed video
(+ optional scene), return the top-N most-similar scenes from other
videos that have a playable dub in the requested locale. Matches the
contract of apps/cms `GET /api/scene-embedding/recommendations` and
`sceneRecommendations` GraphQL query byte-for-byte (modulo cuid-string
ids) so apps/web can swap base URL at R8 cutover with zero response-
shape drift.

- **Shared service:** `src/services/scene-recommendations.service.ts`
  (`SceneRecommendationsService`). One `getRecommendations(params)`
  entry point called by both the REST route and the GraphQL resolver.
  Constants ported from cms: `DEFAULT_LIMIT = 10`, `MAX_LIMIT = 50`,
  `OVERFETCH_FACTOR = 3`.
- **Retriever:** `src/services/scene-recommendations-retriever.ts`
  exports four `$queryRaw` helpers:
  - `resolveSlugToVideoId(slug)` — non-deleted `video.slug` → cuid.
  - `fetchInputEmbeddings(videoId, locale, sceneIndex?)` — per-scene or
    per-video input embeddings in the requested locale.
  - `getRelatedVideoIds(videoId)` — self + parent + child via the
    `video_relation` table.
  - `queryScenesSimilar(queryEmbedding, locale, excludeIds, limit)` —
    DISTINCT ON over `video_scene_locale.embedding`, locale-filtered
    via the 3-hop `VideoDub(edition, language)` chain, with
    `v.deleted_at IS NULL + video_locale.status='published'` consumer
    visibility. Playback is resolved via LATERAL + **INNER JOIN** on
    dub/mux so rows without a resolvable playback are filtered out
    (preserves cms's non-null `playbackId` contract; distinct from R4
    hybrid search which uses LEFT JOIN).
- **Dedup:** 3-layer video dedup (coreId prefix, exact title, embedding
  cosine > 0.95) via the shared `dedupeByVideoIdentity` primitive in
  `src/services/video-dedup.ts`. Same primitive R4 hybrid-search uses.
- **Per-scene vs per-video modes.** Per-scene (sceneIndex provided OR
  seed has one scene) runs one similarity query with
  `limit * OVERFETCH_FACTOR` overfetch. Per-video (seed has multiple
  scenes) queries each scene, merges best-similarity-per-candidate,
  then dedups. Ported verbatim from cms's `getRecommendations`.
- **Identity delta from cms.** `videoId` on the response is a **cuid
  `ID!`** (not cms's `Int!`). apps/web's renderer uses it only as a
  React key, so the cutover is a one-line TypeScript-type update on
  `apps/web/src/lib/recommendations.ts::SceneRecommendation`. Documented
  in plan §Key Technical Decisions #2.
- **`imageUrl` is null** (cms parity stance inherited from R4). Wiring
  a real `imageUrl` from `VideoImage` / MuxVideo thumbnail is a
  post-cutover upgrade so the pre-R8 diff-against-cms invariant holds.
- **REST endpoint:** `GET /api/scene-embedding/recommendations`
  (singular) at `src/app/api/scene-embedding/recommendations/route.ts`.
  Query params: `videoId`, `slug`, `locale` (required),
  `sceneIndex?`, `limit?`. At least one of `videoId`/`slug` required.
  Response envelope: `{ recommendations: SceneRecommendation[] }`.
  Status codes: 400 validation, 404 `VideoNotFoundError`, 429 rate
  limit, 503 unexpected failure. Rate-limit bucket
  `"recommendations"` at 30/min (distinct from search's bucket so they
  don't starve each other).
- **GraphQL:** public `sceneRecommendations(videoId, slug, locale,
sceneIndex, limit): [SceneRecommendation!]!` query at
  `src/graphql/queries/scene-recommendations.ts`. `authScopes: {
public: true }`. `VideoNotFoundError` soft-swallowed to `[]` so the
  apps/web block renders an empty state (matches cms's resolver).
  `schema.test.ts` asserts the new `SceneRecommendation` type exposes
  no `embed|vector`-shaped field; `similarity` is allowed (cms parity).
- **Zod block variant:** `VideoRecommendationsBlockSchema` in
  `src/domain/blocks.ts` — forward-looking schema with no cms
  precedent. Top-level `BlockSchema` only, not valid inside
  `section.content`. Schema lands now; editor UX + renderer come later
  under tatai's feat-100/103.

**Operational runbook:**

1. Ensure R1 scene embeddings are backfilled for the locales you care
   about (prod readiness). `SELECT COUNT(*) FROM video_scene_locale
WHERE locale = 'en' AND embedding IS NOT NULL` should be non-zero
   before canary diffs.
2. Canary diff vs cms. For a fixed set of `(slug, locale)` seeds,
   compare `admin/api/scene-embedding/recommendations?slug=…&locale=…`
   to `cms/api/scene-embedding/recommendations?videoId=…&locale=…`.
   Top-10 should overlap within ±1 ranking position for seeds with
   published dubs in the requested locale. Divergence signals either
   R1 data-readiness gap or an SQL-invariant drift to investigate.
3. Rate-limit monitoring. The `"recommendations"` Redis bucket is new.
   Add to dashboards alongside `"search"` / `"search-health"`.
4. Verify HNSW index usage:
   `EXPLAIN ANALYZE SELECT vs.video_id FROM video_scene_locale vsl
JOIN video_scene vs ON vs.id = vsl.video_scene_id
WHERE vsl.embedding IS NOT NULL AND vsl.locale = 'en'
ORDER BY vsl.embedding <=> '[...]'::vector LIMIT 10;` should show
   the partial HNSW index (same one R1 provisioned).

**Common things to remember:**

- R5 is a READ-SIDE port. No useworkflow dispatch, so no
  dispatch-level test obligation (cf.
  `workflow-dispatch-test-mode-divergence-20260421.md` — applies to
  backfill shapes, not synchronous reads).
- INNER JOIN on dub/mux is intentional and distinct from R4's LEFT
  JOIN. Rows without a playable dub in the requested locale are
  filtered out. If that tightens results vs cms beyond ±1 on the
  canary seeds, measure first — don't loosen the guarantee
  reactively; apps/web's renderer consumes `playbackId` as `String!`.
- The 3-layer dedup lives in `src/services/video-dedup.ts` now. Both
  R4 and R5 call `dedupeByVideoIdentity`. Editing the primitive
  affects both surfaces — update both test files (`video-dedup.test.ts`
  - `hybrid-search-fusion.test.ts`) when touching dedup behavior.
- `VideoRecommendationsBlockSchema` has no cms precedent and no
  renderer yet; it's schema-only until feat-100/103 gives it an
  authoring surface.

The primary learnings doc is
`docs/solutions/platform/admin-scene-recommendations-r5-pattern.md`.

## Running embeds locally (R1 + R2)

Local-dev workflow for populating a freshly-synced `forge_admin` DB
with scene + transcript embeddings — bypasses the GraphQL trigger
path and the Cloudflare 524 edge timeout. Per
`docs/plans/2026-04-29-006-feat-local-embed-pipeline-and-manager-trigger-plan.md`.

**Three-step runbook:**

1. **Pull the prod mapping snapshot to local fallback:**

   ```bash
   RAILWAY_S3_ACCESS_KEY_ID=... \
   RAILWAY_S3_SECRET_ACCESS_KEY=... \
   pnpm --filter @forge/admin pull:mapping
   ```

   Downloads `s3://cms-storage-jbpuckp0lmqap/admin-migrations/core-id-mapping.json`
   (admin's prod bucket — same key the GraphQL workflow reads in
   prod) into `apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json`.
   Admin's `src/storage/s3.ts` `getObject` falls back to that path
   when `RAILWAY_S3_BUCKET` is unset, so the workflow reads it
   transparently at runtime.

2. **Configure manager-bucket creds + (R1 only) an embedding key
   in `apps/admin/.env`:**

   ```
   MANAGER_ARTIFACTS_S3_ENDPOINT=...
   MANAGER_ARTIFACTS_S3_REGION=...
   MANAGER_ARTIFACTS_S3_BUCKET=...
   MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID=...
   MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY=...
   # R1 only — R2 reuses vectors from manager's embeddings.json
   OPENROUTER_API_KEY=...
   ```

   Pull these from Railway's `forge-admin` service env (read-only —
   manager bucket is read-only at the code layer).

3. **Run the pipeline:**

   ```bash
   DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
   pnpm --filter @forge/admin run-embeds --pipeline=transcript
   #   --pipeline=scene|transcript|both         (required)
   #   --core-id=<id>          (repeatable; restrict to specific videos)
   #   --locale=<bcp47>        (repeatable; R1 filter)
   #   --language=<bcp47>      (repeatable; R2 filter)
   #   --mapping-key=admin-migrations/core-id-mapping.json   (default)
   ```

   Direct-invokes `runSceneEmbeddingBackfill` /
   `runTranscriptEmbeddingBackfill` against the in-process Prisma
   singleton, mirroring `pnpm run-sync`. Per-pipeline error
   isolation; structured JSON output. R2 is free (vector reuse from
   manager's `embeddings.json`); R1 hits OpenRouter.

**Local DB is the destination.** `DATABASE_URL` is the only safety
guard — there is no in-script check that detects a prod URL. Mirrors
`run-sync.ts`'s posture; operator discipline applies.

**Long-running invocations.** R1 + R2 runs across the full local
catalogue can take many minutes — the CLI blocks in-process. If you
need to walk away from the terminal, use `tmux` / `screen` / `nohup`
so a session disconnect doesn't kill the run mid-flight:

```bash
nohup pnpm --filter @forge/admin run-embeds --pipeline=both \
  > .tmp/run-embeds-$(date +%s).log 2>&1 &
```

The CLI is **safe to interrupt** — Ctrl-C / SIGTERM disconnects the
prisma client cleanly and exits with code 130. Workflow upserts are
idempotent, so re-running picks up where the last run left off. Do
NOT assume a run completed if your terminal closed mid-stream
without seeing the final `run-embeds.complete` event.

The new solutions doc
`docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`
captures the architectural pattern (local-fallback storage trick,
direct-invoke shape, prod-mapping-pull rationale).

## Triggering embeds from manager

Manager exposes thin REST proxies that forward to admin's existing
GraphQL trigger mutations. Same workflow runs end-to-end on admin's
side — manager owns presentation, admin owns execution. No workflow
duplication; data ownership stays with admin.

**Endpoints (manager-side):**

- `POST manager/api/admin-embeds/scene` — body `{ mappingS3Key?,
coreIds?, locales? }`. Proxies to admin's
  `triggerSceneEmbeddingBackfill`.
- `POST manager/api/admin-embeds/transcript` — body `{ mappingS3Key?,
coreIds?, languages? }`. Proxies to admin's
  `triggerTranscriptEmbeddingBackfill`.

Both gate manager-side via `authenticateRequest` (Strapi JWT cookie
or `MANAGER_API_KEY` bearer) before forwarding.

**Admin-side auth posture (plan 006):** admin's GraphQL context
mints a request-bound `WORKFLOW_TRIGGER` principal when an incoming
request carries `Authorization: Bearer <key>` matching one of the
keys in `WORKFLOW_API_KEYS` (the same env var the workflow callback
endpoint validates with HMAC). The `WORKFLOW_TRIGGER` role
satisfies a narrow allowlist defined in `src/auth/permissions.ts`
(`WORKFLOW_TRIGGER_PERMISSIONS`) — currently
`write:scene-embeddings` + `write:transcript-embeddings` and
nothing else. Adding mutations to that allowlist widens the bearer
caller's blast radius; do so deliberately. See
`src/auth/workflow-bearer.ts`.

**Env (manager):** `ADMIN_GRAPHQL_URL` +
`ADMIN_EMBED_TRIGGER_API_KEY` on `forge-manager` Doppler. The key
must match an entry in admin's `WORKFLOW_API_KEYS` CSV.

## Common pitfalls (grows with each unit)

- **`apps/admin/railway.toml` is dead config — Railway only auto-discovers `railway.toml` at the repo root**, not in per-service subdirectories. Editing it does NOT change deploy behavior. The Railway dashboard is authoritative until "Config-as-code Path" is wired up. Trap surfaced 2026-04-29 after silently skipping 5 PRs of migrations; see `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`.
- **Railway MCP writes are staged, not applied** — `updateServiceTool` writes to a buffer; flush with `accept-deploy(environmentId)`, not `redeploy`. See `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.
- `[deploy.env]` in `railway.toml` is unreliable — put env vars in Railway dashboard.
- PostgreSQL 18 on Railway: `?::jsonb::text[]` cast unsupported. Use PG array
  literal `{val1,val2}` with `?::text[]` — see `src/db/pgvector.ts::toPgArray()`.
- Prisma 7.1.0 has pgvector migration regressions (Prisma issue #28867). Pin
  to Prisma 6.x until resolved.
- Pothos Prisma plugin requires `dmmf: Prisma.dmmf` in the builder config
  when `client` is a function (not a direct instance).
- Next.js App Router route handlers cannot directly export the Yoga instance:
  type signatures mismatch. Wrap in a `(request, context) => yoga.handle(...)`
  function and export that as `GET`/`POST`/`OPTIONS`.
