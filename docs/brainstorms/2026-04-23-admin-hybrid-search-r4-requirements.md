---
date: 2026-04-23
topic: admin-hybrid-search-r4
---

# R4 — Hybrid Search API in Admin

## Problem Frame

apps/cms ships the consumer-facing hybrid search today
(`/api/search` + `/api/search/health`). The admin-migration playbook at
`docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
calls for porting it to `apps/admin` as R4 so that, at R8 cutover,
apps/web and apps/mobile can swap their search backend in a single
coordinated PR with no consumer-visible change.

R4 is explicitly a **port, not a refactor**. New features (transcript
fusion, re-ranking, personalization) stay out. The job is to replicate
cms's behavior on admin's data model so the two services are
byte-compatible at the response boundary during the R3→R8 window.

## Requirements

- **R1.** Port cms's hybrid search orchestrator to admin as a shared
  `HybridSearchService`. Preserve the existing contract:
  - 4-list Reciprocal Rank Fusion (RRF): `semantic-video`,
    `keyword-video`, `semantic-experience`, `keyword-experience`.
  - `Promise.allSettled` so one retrieval failing does not discard the
    others; failed lists log at error level and contribute zero results.
  - Overfetch factor **3x**, default limit **20**, max limit **50**.
  - RRF constant **k = 60**; score normalized to [0, 1] by dividing by
    `lists.length / (k + 1)`.
  - Empty lists filtered out before fusion (RRF divides by list count).
  - 3-layer dedup applied to video results only: coreId prefix match,
    exact title match, embedding cosine > 0.95. Experience results pass
    through unchanged.
  - Dedup to `offset + limit + 1` to derive `hasMore` without a count pass.

- **R2.** Expose the service at REST: `GET /api/search` and
  `GET /api/search/health` as Next App Router route handlers calling
  the shared service. Response body matches cms's shape exactly:

  ```
  { results: SearchResult[], hasMore: boolean, query: string,
    searchMode: "hybrid" | "keyword-only" }
  ```

  `SearchResult` fields: `type`, `id`, `slug`, `title`, `imageUrl`,
  `snippet`, `startSeconds`, `playbackId`, `score`. `startSeconds` and
  `playbackId` are null for experience results and for keyword-only
  video matches.

- **R3.** Expose the service at GraphQL as a public `search(...)` query
  field that returns the same logical shape. Auth scope `public: true`
  (matches cms's `auth: false` route and admin's existing
  `searchExperiences` field).

- **R4.** Query-parameter contract on REST matches cms:
  - `q` (required, non-empty, trimmed) → 400 when missing/blank.
  - `locale` (required) → 400 when missing. Data-derived — whatever
    BCP-47 values admin's corpus actually carries.
  - `type` (optional) — one of `"video" | "experience"`. Omitted or
    empty → both content types. Invalid value → 400.
  - `limit`, `offset` (optional) — numeric; clamped server-side.

- **R5.** `searchMode` degradation signal follows cms's rule: set to
  `"hybrid"` when the OpenRouter (or admin's chosen provider) query-
  embedding call succeeds; set to `"keyword-only"` when it throws. Any
  embedding failure is logged at error level with
  `event=query_embedding_failure error_class=… message=…` structure and
  increments a process-local failure counter. Response is always HTTP
  200 when orchestration completes; 503 is reserved for total
  orchestrator failure.

- **R6.** `/api/search/health` is a synthetic probe:
  - Runs one real `embedQuery("health probe")` with a 5s timeout.
  - Always returns HTTP 200. Body:
    `{ status: "ok" | "degraded", error: string | null, attempts,
failures, lastErrorMessage, lastErrorClass, lastErrorAt }`.
  - Probe failures increment the same process-local counters the search
    orchestrator updates — one unified view of embedding-call health.
  - Dedicated rate-limit bucket (tighter cap than user-search) so probe
    traffic cannot starve the user quota and vice versa.

- **R7.** Semantic retrieval sources in admin:
  - `semantic-video` → `VideoSceneLocale.embedding` (pgvector cosine,
    `DISTINCT ON (video_id)`, locale-filtered). One scene per video.
    Parity with cms's `scene_embeddings` table.
  - `semantic-experience` → `ExperienceLocale.embedding` (pgvector
    cosine, locale-filtered). Reuses the SQL shape of admin's existing
    `ExperienceSearchService` but returns scalar rows (not Prisma
    hydrated) because the service needs to feed RRF, not GraphQL.
  - `VideoTranscriptChunk.embedding` (R2-indexed) is **not** used by
    R4 — strict cms parity. A post-R8 follow-up can add it as a 5th
    list without changing the consumer contract.

- **R8.** Keyword retrieval sources in admin:
  - `keyword-video` → tsvector over `video_locale.title` +
    `video_locale.description` (or the equivalent field names on
    admin's model), `plainto_tsquery('simple', …)`, `ts_rank` ordering,
    locale-filtered.
  - `keyword-experience` → tsvector over `experience_locale.title` +
    `experience_locale.meta_description`, same `simple` config, same
    ranking fn, locale-filtered, `status = 'PUBLISHED'` + non-archived.
  - GIN indexes on the tsvector expressions are added as part of R4
    (admin has none today). Expression must match the query expression
    exactly or the index is unused.
  - Empty/whitespace-only query short-circuits to `[]` before any SQL.

- **R9.** PUBLIC callers (unauthenticated REST and `public: true`
  GraphQL) see only rows with published + non-archived status. ABAC is
  applied in the raw SQL layer (WHERE clause on `status`,
  `archived_at`, and the publish state on relevant link rows). No
  preview / draft leakage.

- **R10.** Every component re-derives its invariants from admin's
  schema — no copy-paste of cms's DISTINCT ON joins, link-table chains,
  or status enums without confirming each one maps to admin's Prisma
  model. (Per
  `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`.)

## Success Criteria

- apps/web and apps/mobile could, today, swap their `/api/search` base
  URL from cms to admin and see response bodies that parse against
  their existing TypeScript types with zero changes.
- For a fixed set of canary queries × locales, the top-10 results from
  admin vs cms overlap within ranking position ±1 for the same seed
  data. Divergences trace to data-model differences (e.g. a published
  video in cms not yet dumped into admin), not to algorithm drift.
- `searchMode: "keyword-only"` surfaces reliably when the embedding
  provider is unreachable — verified by temporarily pointing admin at
  an invalid `OPENROUTER_API_KEY` in a preview environment.
- `/api/search/health` returns `status: "ok"` under normal conditions
  and `status: "degraded"` within 5s of provider unavailability.
- p95 latency < 500ms for `limit=20` on admin's production corpus size
  (matches the playbook's stated success bar for the migration).
- Admin GraphQL `search(...)` query returns the same rows in the same
  order as the REST endpoint for identical arguments.
- `schema.test.ts` guards the existing "no embed/vector/similarit"
  surface leak invariant — none of R4's new Pothos types expose raw
  vectors or cosine similarity scores via relations.
- Integration tests cover empty query, locale-only data-derivation,
  `type=video`, `type=experience`, missing args (400s), provider-down
  degradation, and the probe endpoint's ok/degraded branches.

## Scope Boundaries

- **No changes to apps/cms beyond reading the port reference.**
  cms's hybrid search continues serving consumers until R8.
- **No new ranking features.** Transcript embeddings, cross-encoder
  re-ranking, personalization, and popularity boosts are out. R4 is a
  port; cms parity is the bar.
- **No schema stitching or gateway** at either REST or GraphQL.
- **No deprecation of admin's existing `searchExperiences` GraphQL
  query** in this PR. It takes a pre-computed vector and serves a
  different use case; if anything it becomes redundant, but removing
  it is a follow-up.
- **No cutover of apps/web or apps/mobile.** That is R8, and it
  requires R5 (recommendations) and R7 (revalidation webhook) alongside
  R4.
- **No recommendations endpoint.** `/api/scene-embeddings/recommendations`
  is R5. R4 only ships `/api/search` and `/api/search/health`.
- **No hardcoded locale or language defaults.** If the corpus has zero
  rows for a locale, that locale returns zero results — not an `en`
  fallback. Per
  `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`.
- **No useworkflow dispatch** — R4 is read-side, synchronous. No
  `"use workflow"` functions, therefore no dispatch-level test
  obligation from
  `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`.
  That constraint applies to R1/R2/R3-shaped backfills, not to
  synchronous read APIs.

## Key Decisions

- **App Router route handler calling a shared service.** `/api/search`
  and `/api/search/health` live at
  `apps/admin/src/app/api/search/route.ts` and
  `apps/admin/src/app/api/search/health/route.ts`. Both call a shared
  `HybridSearchService` that the GraphQL `search` resolver also calls.
  REST has no GraphQL overhead; `/api/search/health` stays a cheap
  synthetic probe. Establishes the REST-handler pattern admin will
  reuse in R5 (`/api/scene-embeddings/recommendations`) and R7
  (revalidation webhook). (User-confirmed, 2026-04-23.)

- **Scene embeddings only for `semantic-video`.** Strict cms parity.
  Transcript embeddings stay indexed but unused by R4 so admin's
  ranking stays diff-able against cms during the R3→R8 validation
  window. Adding a 5th list is a post-cutover enhancement.
  (User-confirmed, 2026-04-23: "this is a migration, not a refactor.")

- **PUBLIC at both REST and GraphQL.** Matches cms's current `auth:
false` REST route and admin's existing `searchExperiences` GraphQL
  field. PUBLIC enforcement happens in SQL (WHERE `status =
'PUBLISHED'` and `archived_at IS NULL`).

- **RRF k = 60, overfetch 3x, default 20, max 50.** Copied verbatim
  from `apps/cms/src/api/search/services/search.ts:14-17`. Any change
  is a post-R8 consideration.

- **Health probe always returns HTTP 200.** Body's `status` field is
  the machine-readable signal. Matches cms's behavior so external
  monitors (Railway healthcheck, uptime tools, curl checks) that poll
  today work unchanged when swapped to admin's URL.

- **Process-local health counters.** No Prometheus / metrics sink.
  `/api/search/health` is the pollable surface. Matches cms. Real
  metrics sink is a cross-cutting platform decision outside R4's scope.

## Dependencies / Assumptions

- Admin's `VideoSceneLocale` corpus is non-empty in prod for at least
  one locale. If R1's full prod backfill hasn't run yet (gated on the
  read-only cms PG role + Doppler `CMS_DATABASE_URL`), `semantic-video`
  returns zero rows and RRF falls back to the three remaining lists.
  This is a data-readiness observation, not a blocker for shipping R4
  code.
- Admin already has an `embedQuery`-equivalent provider (OpenRouter or
  OpenAI) wired via `src/services/embedding.service.ts` or similar —
  reuse it; don't introduce a second provider client.
- `pgvector` is installed on admin's Postgres (confirmed — R1, R2, R3
  ship against it).
- Admin's Postgres extension surface supports `to_tsvector` /
  `plainto_tsquery` / `ts_rank` natively (standard Postgres — no
  extension needed).
- Admin's rate-limit plugin (`src/graphql/plugins/rate-limit.ts`) or
  an equivalent at the route-handler layer can enforce per-IP caps on
  `/api/search` and a separate tighter cap on `/api/search/health`.
  Whether admin exposes this to route handlers today needs a quick
  check in planning.

## Outstanding Questions

### Resolve Before Planning

_(none — all blocking product decisions resolved in this brainstorm)_

### Deferred to Planning

- **[Affects R8][Technical]** Field mapping between cms's
  `videos.title/description` + `video_variants` publish/locale chain
  and admin's `Video` / `VideoLocale` / `VideoDub` model. Planning
  must inspect admin's Prisma schema and write the equivalent JOIN
  chain — the structure is cms-authoritative-text vs admin-per-locale-
  text, which changes the SQL shape even though the output columns
  match.
- **[Affects R2][Technical]** Rate-limit enforcement for App Router
  route handlers. Admin's existing rate-limit plugin is GraphQL-Yoga-
  scoped; applying it to a plain `route.ts` requires either a
  middleware or a direct call into the limiter from the handler.
  Planning picks the shape.
- **[Affects R1][Needs research]** cms's video semantic search returns
  `playback_id` and `start_seconds` from `scene_embeddings`. Admin's
  `VideoSceneLocale` carries the description + embedding; the Mux
  `playbackId` lives on `MuxVideo` (referenced by `VideoEdition`).
  Planning must trace the admin join chain from scene → edition → mux
  to produce the same output columns.
- **[Affects R1][Technical]** `embedding::text` is exposed from cms's
  semantic-video SQL so the 3-layer dedup can recompute cosine
  similarity across results. Admin's `schema.test.ts` blocks any
  GraphQL field shaped like `embed|vector|similarit`. The raw SQL
  in the service is fine (not a GraphQL surface) — confirm planning
  treats this as a service-internal transport, not a leak.
- **[Affects R8][Needs research]** Does admin's `keyword-experience`
  tsvector expression need to match a GIN index name and expression
  exactly like cms's `experiences_fulltext_search_idx`? Admin has no
  such index today; planning creates one in the migration and wires
  the service to match byte-for-byte.
- **[Affects R9][Technical]** EDITOR / ADMIN expanded result set.
  cms's hybrid search is PUBLIC-only and never shows drafts. Admin's
  `ExperienceSearchService.search` has an `isPrivileged` branch that
  widens the WHERE. Decision: does admin's new hybrid `search` field
  also honor elevated roles (useful for the admin dashboard's own
  search UX), or stay strictly PUBLIC-equivalent to match cms? Lean
  toward "stays strictly PUBLIC-equivalent in R4, and the admin
  dashboard keeps using `searchExperiences` with its existing
  elevated-role semantics." Confirm in planning.

## Next Steps

→ `/ce:plan` for structured implementation planning.
