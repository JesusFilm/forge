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

Railway service `forge-admin` (Doppler project of the same name).
Deployment caveats in `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
apply: set `HOSTNAME=0.0.0.0` in Railway dashboard (not `[deploy.env]`).

## Migrations

History was collapsed into a single `0001_init` migration during Phase 2
because no production database existed yet. Future schema changes append
new migration files as normal — never rewrite `0001_init`.

If a deployed environment ever applied an earlier iteration of these
migrations (none did), the recovery path is to drop and re-apply against a
fresh DB.

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
  enumerates `(video, edition)` pairs and indexes each locale. Per-target
  error isolation; `artifact_missing` errors skip, provider errors fail
  but don't halt the run. Safe to re-run.
- **Trigger:** `triggerSceneEmbeddingBackfill` GraphQL mutation
  (ADMIN-only; permission key `write:scene-embeddings`).

**Operational runbook:**

1. Refresh the coreId → cms video id mapping into the shared Railway S3
   bucket: `pnpm --filter @forge/admin refresh:core-id-mapping`. The
   CLI dumps from cms and uploads to
   `admin-migrations/core-id-mapping.json`. Re-run when cms's catalog
   grows (Strapi SERIAL ids don't change, so existing entries stay
   valid).
2. Ensure `OPENROUTER_API_KEY` or `OPENAI_API_KEY` is set on the
   `forge-admin` Railway service.
3. Invoke `triggerSceneEmbeddingBackfill` via GraphQL. `mappingS3Key`
   defaults to `admin-migrations/core-id-mapping.json`; override for
   dry runs or ad-hoc snapshots. Restrict with `coreIds` or `locales`.
4. Verify: `SELECT COUNT(*) FROM video_scene_locale WHERE embedding IS NOT NULL`
   grows as expected; `SELECT DISTINCT video_edition_id FROM video_scene`
   enumerates the indexed editions.

The primary learnings doc is
`docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`.

## Common pitfalls (grows with each unit)

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
