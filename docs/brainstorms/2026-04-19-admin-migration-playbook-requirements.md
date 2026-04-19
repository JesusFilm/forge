---
date: 2026-04-19
topic: admin-migration-playbook
---

# Admin Migration Playbook — Moving Nisal's Work From cms → admin

## Problem Frame

`apps/admin` (Forge Admin) is the strategic replacement for `apps/cms`
(Strapi v5). Admin's V1 foundation is operational and authored all the
patterns we want to keep: Prisma + pgvector, useworkflow, Better Auth,
per-locale content model, hardened Core sync, generic ContentRevision
log, ABAC-enforced service layer.

Nisal has built nine complete work streams inside `apps/cms` over the
past several months — scene / transcript / experience embeddings,
hybrid semantic search API, recommendation query API, the recommendations
block, Strapi's revalidation webhook, and perf'd core-sync. All of it
must move into `apps/admin` so Strapi can eventually be deleted by the
platform team.

Nisal also owns five unstarted personalization tickets (feat-090–094:
watch events, FPMC, Two-Tower, cold start, A/B logging) that will be
built natively in admin rather than in cms, since they have no cms
implementation yet.

Strapi will not be turned off as part of this scope — deletion of
`apps/cms` and the `feat-022 CMS Foundation` kill switch is a separate
downstream task owned by the platform team after Nisal's migration
completes.

## Context: What's Already In Admin

- Experience + ExperienceLocale Prisma models with `embedding vector(1536)`
  column on `ExperienceLocale`, partial HNSW index (NULL-excluded)
- Dual-provider embedding service (OpenRouter or OpenAI), Zod-validated
- useworkflow experience-embedding pipeline (`runExperienceEmbedding`)
- `ExperienceSearchService` with raw SQL pgvector + Search Hydration
  Pattern + ABAC re-applied at hydration
- Hardened Core sync orchestrator: Zod-validated per-phase, soft-delete
  on full sync, atomic per-page transactions, Redis-backed GraphQL rate
  limit
- Generic `ContentRevision` append-only log (60-day retention) covering
  ExperienceLocale, Experience, VideoLocale, Video, VideoDub
- Better Auth + Firebase fallback; cross-subdomain cookies
  (`.jesusfilm.org`) so all apps share sessions
- Pothos types covering Experience, Video, VideoDub, reference data
- Admin dashboard operational: `/dashboard/experiences` (full CRUD),
  `/dashboard/embeddings`, `/dashboard/search`, `/dashboard/videos`,
  `/dashboard/workflows`

## Context: What's NOT In Admin (The Migration Target)

- Scene / transcript embedding storage and indexer
- Hybrid (RRF) keyword + semantic search fusion
- Keyword/FTS retrieval (GIN indexes, `tsvector`/`tsquery`)
- REST `/api/search` endpoint with `type` filter, `searchMode` signal,
  `/api/search/health` probe
- Recommendation query API (`/api/scene-embeddings/recommendations`)
- Recommendations block variant in Zod `BlockSchema`
- Watch event collection / FPMC / Two-Tower / cold-start / A/B logging
- Revalidation webhook emitting to `apps/web`'s ISR listener
- Admin GraphQL mutations that cover manager's enrichment write surface

## Requirements

- **R1 — Scene embeddings infra in admin.** Port the scene-embedding
  storage, indexer, and backfill from cms to admin. Re-index from
  `apps/manager`'s existing S3 `embeddings.json` artifacts (same model,
  same vectors — no regeneration). Admin gains a scene embedding Prisma
  model, an indexer service that downloads and inserts vectors, and a
  useworkflow backfill job that iterates all videos.

- **R2 — Transcript embeddings in admin.** Same pattern as R1. Small
  delta; rides on R1's storage and indexer foundation.

- **R3 — Experience content migration (one-shot).** Dump existing
  Strapi experiences and transform them into admin's per-locale row
  model. One-shot script, not a live sync. After the dump, new
  experience authoring happens only in admin. Existing Strapi
  experiences continue to render from cms until consumer cutover (R8).

- **R4 — Hybrid search API in admin.** Port the hybrid retrieval +
  Reciprocal Rank Fusion orchestrator from cms. Covers the full
  feat-010 + feat-086 + feat-097 contract: semantic + keyword
  retrieval across video and experience content types, 4-list RRF,
  `type=video|experience` filter, `searchMode: "hybrid" | "keyword-only"`
  signal, `/api/search/health` probe. Exposed at both REST (matching
  existing `/api/search` shape) and admin GraphQL.

- **R5 — Recommendation API + Recommendations block in admin.** Port
  the scene-similarity recommendation query from feat-044, including
  locale-aware filtering and the 3-layer dedup. Add the
  `ComponentBlocksVideoRecommendations` variant to admin's Zod
  `BlockSchema`. Match feat-044's REST contract so apps/web's existing
  recommendations block renderer works unchanged at cutover.

- **R6 — Personalization stack built natively in admin.** Implement
  feat-090–094 (watch events table + session cookie, FPMC video-page
  recs, Two-Tower, cold-start context recs, A/B impression logging)
  against admin's database. No cms detour. watch_events is a public
  endpoint (no auth) but rides on admin's existing session + rate-limit
  infrastructure.

- **R7 — Revalidation webhook on admin's write path.** Admin emits
  revalidation events on canonical writes (publish, archive, sync
  soft-delete, ContentRevision promote). apps/web's existing
  revalidation listener is unchanged. Replaces the Strapi
  `entry.create|update|delete|publish|unpublish` webhook.

- **R8 — Consumer cutover (one-shot GraphQL swap).** apps/web and
  apps/mobile switch from `packages/graphql` (pointed at Strapi) to
  admin GraphQL in a single coordinated PR. Gated on R1–R7 being
  complete so admin has full schema coverage for every query the
  consumer apps issue today. Any per-route incremental fallback is a
  signal that R1–R7 are not actually done.

- **R9 — Manager cutover.** apps/manager stops writing to Strapi and
  starts writing to admin via admin's GraphQL mutations (or a dedicated
  internal ingest endpoint). Requires admin to expose every mutation
  manager currently depends on.

## Success Criteria

- All nine of Nisal's migration work streams land as merged PRs against
  `main` with green CI.
- After R8, apps/web and apps/mobile issue zero GraphQL queries against
  `apps/cms` in production.
- After R9, apps/manager issues zero GraphQL mutations against
  `apps/cms` in production.
- Search API response times remain <500ms p95 post-migration.
- Semantic search degradation signal (`searchMode`) surfaces correctly
  on admin, matching the feat-097 hardening contract.
- No regression in recommendation quality: top-10 cosine similarity
  results on the admin recommendation API match cms's results for a
  fixed set of seed queries within ranking position ±1.
- Experience embedding backfill produces non-NULL embeddings for every
  published ExperienceLocale in admin.
- Scene + transcript embeddings re-indexed from S3 match cms row counts
  per video (sanity check the indexer covered every asset).

## Scope Boundaries

- **Strapi deletion is out of scope.** The platform team (or whoever
  owns `apps/cms` removal) takes over after R9 merges. `feat-022` kill
  switch is not Nisal's responsibility.
- **No new cms features.** All new Nisal code lands in `apps/admin`.
  Only hotfixes to already-shipped cms code allowed, and even those
  should be rare.
- **No per-route incremental GraphQL swap.** One-shot at R8 or it's not
  ready. Half-migrated consumer state is explicitly rejected.
- **No re-embedding of scene / transcript embeddings.** Source vectors
  come from manager's S3 artifacts. Regenerating would waste OpenRouter
  spend for identical output.
- **No schema stitching or GraphQL gateway.** The two schemas stay
  independent; consumers switch clients at R8.
- **No dual-write phase for manager.** Manager cuts over cleanly at R9,
  not a dual-write interim where both cms and admin receive the same
  writes.
- **No backfill of historical watch events from cms.** R6's watch event
  collection starts fresh in admin; cms never had a watch event table
  to migrate from.
- **Editor UX parity is not blocking.** Admin's editor UI (feat-100,
  feat-103) continues to evolve in parallel under tatai's ownership.
  Migration work does not wait for editor surfaces to reach full CMS
  parity.

## Key Decisions

- **Databases stay separate.** Admin and cms run against different
  Postgres instances with incompatible schemas. No shared tables, no
  cross-DB queries, no Foreign Data Wrappers.
  **Why:** admin uses `cuid()` text ids and per-locale rows; cms uses
  integer SERIAL ids and field-level i18n. The schemas can't coexist
  in one DB. Migration is per-artifact transforms, not a DB merge.

- **Embeddings are re-indexed from S3, not re-generated or copied.**
  Manager writes `embeddings.json` artifacts to Railway S3 during
  enrichment. cms's indexer downloads and inserts. Admin's new indexer
  (R1, R2) does the same. Same vectors, same model, zero OpenRouter
  spend.
  **Why:** manager's S3 is already the canonical source of embedding
  data; cms has always been a cache of it. Avoids the cost of
  re-generation and the complexity of `pg_dump`-style vector-column
  copy between incompatible schemas.

- **Experience embeddings are re-generated for existing Strapi
  catalog.** The <100 experiences × 3 locales are re-embedded in admin
  after R3's content migration using admin's existing
  `generateExperienceEmbedding` workflow.
  **Why:** experience embedding input is derived from admin's
  BlockSchema-shaped content, which differs from Strapi's dynamic-zone
  shape. Generating in admin guarantees the text-flattener matches
  admin's block model.

- **One-shot consumer cutover, not per-route.** apps/web and
  apps/mobile swap their GraphQL client in a single coordinated PR at
  R8.
  **Why:** per-route migration means maintaining two clients, two
  schemas, and two query conventions for weeks. R1–R7 put admin at
  full schema coverage, which means there's no technical barrier to
  one-shot. The risk reduction from incremental is illusory when the
  missing feature would just be "admin not ready" — solve that in
  R1–R7 instead.

- **Manager cuts over cleanly at R9, no dual-write.**
  **Why:** dual-write doubles failure modes and creates drift
  whenever a write succeeds in one DB and fails in the other. A clean
  cutover after admin has mutation parity is simpler.

- **All new cms-class work happens in admin from now on.**
  **Why:** Tatai's direction from feat-086: "Strapi continues serving
  existing consumers; the admin app is additive until explicit cutover
  work lands." Adding new features to cms extends Strapi's life and
  creates more cutover debt.

- **Personalization (R6) skips cms entirely, gets built in admin.**
  **Why:** feat-090–094 are unstarted. Building in admin is zero
  migration cost and proves the admin-as-destination pattern before
  tackling heavier migrations. Acts as a live rehearsal for the rest.

## Dependencies / Assumptions

- `apps/manager`'s S3 `embeddings.json` artifacts remain accessible to
  admin's indexer. The S3 bucket and artifact format are stable for the
  duration of the migration.
- `apps/admin`'s Prisma schema can accept net-new models (scene, scene
  vector column, watch event, FPMC tables, impression log) without
  conflicting with tatai's parallel feat-100 / feat-103 work. Schema
  extensions are additive, and migration ordering follows `append-only`
  convention per admin's CLAUDE.md.
- `apps/admin` has a path to expose a REST endpoint at `/api/search`
  and `/api/scene-embeddings/recommendations` in addition to GraphQL.
  This is not yet wired up but is compatible with Next App Router route
  handlers; confirmed in planning.
- apps/web's revalidation listener accepts a payload shape that admin
  can emit. The existing listener contract is documented and stable.
- Tatai's in-progress work on feat-100 (video editorial workflows) and
  feat-103 (experience editor refinement) does not conflict with
  Nisal's migration — they touch editor UI surfaces, not the data
  model or search/rec paths.

## Outstanding Questions

### Resolve Before Planning

_(none — all blocking product decisions resolved in this brainstorm)_

### Deferred to Planning

- **[Affects R1][Technical]** Scene embedding attachment point in admin
  schema: does the scene vector hang off `Video`, `VideoLocale`, or
  `VideoEdition`? Admin's existing subtitle model attaches to
  `VideoEdition` because cuts vary per edition; scenes likely follow
  the same rule but needs confirmation against the scene-embedding
  data model.
- **[Affects R3][Technical]** Experience content transform rules:
  which Strapi block types map to which admin BlockSchema variants?
  Some Strapi components may not have an admin equivalent yet and need
  new Zod variants added.
- **[Affects R4][Technical]** REST endpoint implementation pattern in
  admin: Next App Router route handler calling into a shared service,
  or a dedicated GraphQL-over-HTTP-wrapping pattern? Admin hasn't
  shipped a non-GraphQL REST endpoint yet.
- **[Affects R6][Needs research]** Watch event ingest endpoint
  rate-limiting strategy on admin. admin's existing Redis rate-limiter
  is auth-scoped; watch events are anonymous (session cookie only) and
  need a different bucket.
- **[Affects R7][Technical]** Revalidation event payload contract:
  match the existing Strapi webhook shape exactly, or define a new
  admin-native shape and update apps/web's listener in the same PR?
- **[Affects R8][Needs research]** How does `packages/graphql` get
  regenerated against admin's schema? Current codegen targets Strapi;
  the swap may require dual packages or a codegen reroute.
- **[Affects R9][Technical]** Full mutation surface area manager
  needs: inventory every write manager issues to Strapi today and map
  each to an admin mutation. Scope may exceed what admin exposes
  today.
- **[Affects R9][Needs research]** Auth for manager → admin writes:
  does manager use a Better Auth service account, a workflow API key,
  or something else?

## Next Steps

→ `/ce:plan` for structured implementation planning, starting with R1
(scene embeddings infra in admin) as the foundational step that
unblocks R2, R4, and R5.
