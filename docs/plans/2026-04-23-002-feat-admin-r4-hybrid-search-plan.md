---
title: "feat(admin): R4 — hybrid search API (REST + GraphQL)"
type: feat
status: active
date: 2026-04-23
origin: docs/brainstorms/2026-04-23-admin-hybrid-search-r4-requirements.md
---

# feat(admin): R4 — hybrid search API (REST + GraphQL)

## Overview

Port cms's hybrid search (`/api/search` + `/api/search/health`) to
`apps/admin` as R4 of the admin-migration playbook (see origin:
`docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`).
Same consumer contract; different data model underneath. One shared
`HybridSearchService` fronts both a Next App Router REST handler and a
Pothos GraphQL query so apps/web + apps/mobile can swap their search
backend at R8 cutover with zero response-shape drift.

## Problem Frame

apps/cms currently owns consumer search. It serves a hybrid (semantic +
keyword) API over scene embeddings and experience embeddings with RRF,
falls back to keyword-only when the embedding provider is unreachable,
and exposes a `/api/search/health` probe for monitors. `apps/admin` has
no search surface beyond a limited `searchExperiences` GraphQL query
that takes a pre-computed vector.

R4 replicates cms's behavior on admin's data model. The R3→R8 window is
a validation period during which apps/web, QA, or release diffing may
compare the two endpoints; ranking drift between them undermines that.
Scope is **port, not refactor** — transcript fusion, re-ranking, and
content-shape upgrades (e.g. wiring real experience imageUrls) stay out.

## Requirements Trace

From the origin requirements doc (see origin:
`docs/brainstorms/2026-04-23-admin-hybrid-search-r4-requirements.md`):

- R1. Shared `HybridSearchService` with 4-list RRF (k=60), overfetch 3x,
  default 20, max 50, `allSettled`, empty-list filtering, 3-layer video
  dedup, `hasMore` derived by dedup-to-`offset+limit+1`.
- R2. REST at `GET /api/search` + `GET /api/search/health`; response
  body matches cms shape byte-for-byte.
- R3. GraphQL `search(...)` public field returning the same shape.
- R4. Query-param contract: `q`, `locale` (both required → 400), `type`
  (optional enum), `limit`, `offset`.
- R5. `searchMode` = `"hybrid"` when embedding succeeds, else
  `"keyword-only"`; structured `event=query_embedding_failure` error log.
- R6. `/api/search/health` always HTTP 200 with
  `{status, error, attempts, failures, lastErrorMessage,
lastErrorClass, lastErrorAt}`, shared counters, 5s probe timeout,
  dedicated rate-limit bucket.
- R7. Semantic retrieval: `VideoSceneLocale.embedding` for video;
  `ExperienceLocale.embedding` for experience. Transcript embeddings
  stay unused by R4.
- R8. Keyword retrieval: tsvector GINs over `video_locale.title +
description` and `experience_locale.title + meta_description`; same
  `plainto_tsquery('simple', …)` config; new raw-SQL migration creates
  the indexes.
- R9. PUBLIC-only WHERE enforced in SQL (`status = 'PUBLISHED'`,
  `archived_at IS NULL`, etc.).
- R10. Every DISTINCT ON / join chain / status filter re-derived from
  admin's schema.

## Scope Boundaries

- No cms changes beyond reading source.
- No transcript list in RRF (4-list, not 5-list).
- No new ranking features (no re-ranker, no popularity, no
  personalization).
- No useworkflow dispatch (R4 is synchronous read-side).
- No deprecation of existing `searchExperiences` GraphQL query.
- No apps/web or apps/mobile changes.
- No upgrade of experience `imageUrl` beyond cms parity (stays null for
  experience results in R4; `ExperienceLocale.ogImageUrl` exists on
  admin but wiring it is a deliberate post-cutover follow-up so the
  diff-against-cms invariant holds).
- No hardcoded locale/language defaults anywhere in R4 code.

## Context & Research

### Relevant Code and Patterns

**cms source of truth (reference only; not modified):**

- `apps/cms/src/api/search/services/search.ts` — orchestrator
  (RRF constants, retrieval wiring, `searchMode` logic, unwrapOutcome).
- `apps/cms/src/api/search/services/fusion.ts` — RRF + 3-layer dedup
  - `cosineSimilarityFromText`.
- `apps/cms/src/api/search/services/semantic-search.ts`,
  `keyword-search.ts`,
  `experience-semantic-search.ts`,
  `experience-keyword-search.ts` — four retrievers with their SQL.
- `apps/cms/src/api/search/services/search-health.ts` — process-local
  counters + `withTimeout`.
- `apps/cms/src/api/search/controllers/search.ts` — REST handlers
  (query-param parse, 400/503 paths, health probe).
- `apps/cms/src/api/search/routes/search.ts` — rate-limit bucket names.

**admin patterns to mirror:**

- `apps/admin/src/services/experience.search.ts` — Search Hydration
  Pattern with raw SQL + `$queryRaw` + `toPgVector`. R4's retrievers
  use raw SQL but return scalar tuples feeding the RRF layer, not
  hydrated Prisma rows.
- `apps/admin/src/db/pgvector.ts` — `toPgVector` + `toPgArray`.
- `apps/admin/src/db/client.ts` — Prisma extension strips `embedding`
  from default results; raw `$queryRaw` is unaffected.
- `apps/admin/src/services/embeddings.service.ts` —
  `generateExperienceEmbedding(text)` is the existing synchronous
  provider-fallback embedder (OpenRouter → OpenAI, 30s timeout,
  1536-dim guard). R4 reuses verbatim. (Naming nit — it's generic
  despite the "Experience" prefix; renaming is a follow-up, not part
  of this PR.)
- `apps/admin/src/auth/rate-limit.ts` — `rateLimitAuthRoute({ limit,
route, windowMs, request })` is the route-handler-callable limiter.
  R4 reuses with separate `route` names for search vs health buckets.
- `apps/admin/src/app/api/health/route.ts` — route-handler shape
  reference.
- `apps/admin/src/graphql/queries/search.ts` — existing Pothos
  `searchExperiences` with `authScopes: { public: true }` is the auth
  precedent for the new `search` query field.
- `apps/admin/src/graphql/schema.test.ts` lines 153/184/213 — the
  `/embed|vector|similarit/i` guard that the new query must not trip.

### Institutional Learnings

- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  — re-derive every invariant. cms's `DISTINCT ON (se.video_id)`, its
  `video_variants_language_lnk` chain, its `experiences.locale`
  column as a direct filter — none of these survive the port unchanged.
- `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`
  — no hardcoded `en` fallback. `locale` is required at the boundary
  (400 when missing), and zero-result responses are legitimate
  data signals.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  - `admin-transcript-embeddings-vector-reuse-pattern.md`
  - `admin-experience-content-dump-pattern.md` — structural precedent
    for an R-level solutions doc + a CLAUDE.md section appended in the
    same PR.
- `apps/admin/CLAUDE.md` Common Pitfalls: PostgreSQL 18 +
  `?::jsonb::text[]` caveat doesn't apply here (no array casts needed),
  but note that admin runs on Prisma 6.x pinned; raw SQL is the only
  path for pgvector and tsvector operations.

### External References

None required. cms is the oracle; admin's Prisma schema is the data
model. Standard Postgres `to_tsvector` / `plainto_tsquery` / `ts_rank`

- pgvector `<=>` cosine operator are well-documented Postgres
  primitives already used in cms.

## Key Technical Decisions

- **Shared service, two front doors.** `HybridSearchService` at
  `src/services/hybrid-search.service.ts` exposes a single
  `search(params)` method. The REST handler does query-param parsing
  and HTTP status mapping; the Pothos resolver does arg validation and
  scope enforcement. Both call the same service. This is the decision
  the origin doc flagged as the R4-specific deferred question
  (user-confirmed 2026-04-23).

- **Query-param REST parsing via `new URL(request.url).searchParams`.**
  Admin hasn't shipped a query-string REST handler yet (existing
  handlers either take a JSON body or have no params). R4 establishes
  this pattern. All parsing, trimming, and numeric coercion lives in a
  helper at the top of `route.ts`.

- **`generateExperienceEmbedding` reused as the query embedder.** Its
  name is misleading (it takes a plain string, not an experience), but
  renaming it is an unrelated refactor that would churn R3's call
  sites. R4 adds a thin aliased re-export or simply imports the
  existing function and leaves the rename for a follow-up.

- **Experience results carry `imageUrl: null` for R4.** Strict cms
  parity. Admin's `ExperienceLocale.ogImageUrl` could populate it, but
  that's a content upgrade, not a port. A post-cutover follow-up PR
  flips null → `ogImageUrl` once the diff-against-cms invariant is no
  longer needed.

- **`playbackId` resolved via `VideoScene → VideoDub(editionId ==,
language ==) → MuxVideo`.** In admin, playbackId lives on
  `mux_video`, reachable via `video_dub`. The semantic-video SQL
  resolves it through a LATERAL subquery that picks the dub matching
  `(videoEditionId, language)` for the query's locale and joins
  `mux_video`. If no dub exists for that (edition, locale) pair,
  `playbackId` is null and the result is still returned (keyword-style
  handling inside the semantic list).

- **Keyword-video joins `VideoLocale`, not `Video`.** Admin's title +
  description are per-locale. SQL filters `vl.status = 'PUBLISHED'`
  - `vl.locale = ?` and `tsvector('simple', coalesce(vl.title,'') || '
' || coalesce(vl.description,''))`.

- **PUBLIC visibility enforced in raw SQL, not at the resolver.** Both
  the REST handler and the GraphQL resolver call into the service; the
  only auth gate that guarantees consistent filtering is inside the
  SQL WHERE. EDITOR/ADMIN widening is explicitly NOT added in R4 — the
  existing `searchExperiences` field remains the admin-dashboard path
  for elevated roles.

- **Scene-locale's per-locale embedding column replaces cms's
  `scene_embeddings.embedding`.** cms never had per-locale scene
  embeddings; admin indexes them per-locale (R1). The DISTINCT ON is
  on `vsl.video_scene_id`'s owning `videoId`, filtering
  `vsl.locale = ?`.

- **Keyword SQL `tsvector('simple', …)` expression must be byte-equal
  to the GIN index expression.** Expression mismatch silently reverts
  the query to sequential scan. The expression strings are centralized
  in a constants file (`src/services/hybrid-search-sql.ts`) and used
  from both the migration raw-SQL and the service's query constants
  via TypeScript template literal.

- **RRF k=60, OVERFETCH_FACTOR=3, MAX_LIMIT=50, DEFAULT_LIMIT=20,
  HEALTH_PROBE_TIMEOUT_MS=5000, HEALTH_PROBE_INPUT="health probe".**
  Copied verbatim from cms; constants exported from the service for
  testability.

- **`embedding::text` column in semantic-video SQL is a service-
  internal transport** and never reaches the Pothos resolver or the
  REST response. The `/embed|vector|similarit/i` schema.test.ts guard
  is a GraphQL-surface check; raw SQL fields are out of its scope.
  No new test needed, but plan-unit verification calls this out so
  an implementer doesn't panic-rename the column.

## Open Questions

### Resolved During Planning

- **REST endpoint pattern.** App Router route handler calling a shared
  service (user-confirmed in brainstorm).
- **`semantic-video` source.** `VideoSceneLocale.embedding` only;
  transcripts deferred post-cutover (user-confirmed).
- **Auth scope.** PUBLIC at both REST and GraphQL (user-confirmed).
- **Rate limiter pathway for REST.** `rateLimitAuthRoute` in
  `src/auth/rate-limit.ts` is route-handler-callable and already used
  by `/api/auth`; R4 reuses it with distinct `route` keys.
- **`embedding::text` service-internal transport.** Prisma client
  extension strips from Prisma model results only; raw `$queryRaw`
  passes through. No GraphQL-surface leak because the column never
  reaches a Pothos type.
- **Experience `imageUrl`.** Null for R4, matching cms. Upgrade is a
  post-cutover follow-up.
- **EDITOR/ADMIN on `search`.** Stays PUBLIC-equivalent in R4. The
  admin dashboard keeps using the existing `searchExperiences` field
  for elevated-role flows.
- **Query embedder function.** Reuse
  `generateExperienceEmbedding(text)` from
  `src/services/embeddings.service.ts`; add an aliased export
  (`embedQueryText`) so the call site reads clearly. Do not rename
  the underlying function — out of scope.

### Deferred to Implementation

- **Exact `ts_rank` weighting.** cms uses the default weighting (no
  `setweight`). R4 ports that. If canary queries show title underweighting
  vs cms despite identical SQL, the implementer may need to examine
  whether admin's text differs (e.g. all-lowercase vs mixed case) and
  document any divergence.
- **Fallback behavior when no `VideoDub` matches `(edition, locale)`.**
  Per the key decision, `playbackId` is null for that row. Confirm in
  implementation that the LATERAL subquery's empty match produces
  `NULL` (it does in Postgres; worth a test case).
- **Whether `video.deleted_at IS NULL` belongs in the WHERE.** cms
  filters on `video.published_at IS NOT NULL`. Admin's analogue is
  `video_locale.status = 'PUBLISHED'` AND `video.deleted_at IS NULL`
  (soft-delete guard). The implementer validates against admin's
  actual seeded data — if any soft-deleted video has a published
  locale, the query must not surface it.
- **Minor parity edge cases.** The implementer compares an R4
  preview-environment response to cms's response for a handful of
  canary queries (`"jesus"`, `"easter"`, `"shepherd"`, `"peter
denies"`) in `en` + `es` + `fr` and captures any diff. Goal is
  to confirm ranking parity within ±1 position on the top-10.
- **Rate-limit cap tuning.** cms uses 30/min for `search` and 5/min
  for `search-health`. R4 starts with the same caps; the implementer
  confirms admin's Redis store can carry the per-IP keyspace without
  thrash (should be fine; admin already runs authenticated rate-limits
  at 60/min).

## High-Level Technical Design

> _Directional guidance for review, not implementation specification.
> Treat as context, not code to reproduce._

### Request flow

```
HTTP GET /api/search?q=…&locale=…&type=…&limit=…&offset=…
   │
   ├── rateLimitAuthRoute({route:"search"})           ─┐
   │                                                   │
   ▼                                                   │ 429 if over cap
parse + validate args (400 on q/locale/type)           │
   │                                                   │
   ▼                                                   │
HybridSearchService.search(params) ◀────── Pothos resolver
   │                                         (public: true)
   │                                         graphql/queries/hybrid-search.ts
   ▼
 ┌─────────────────────────────────────────┐
 │ 1. recordAttempt()                      │
 │ 2. embedQueryText(q) ──► number[]       │ ← catch → recordFailure(), searchMode="keyword-only"
 │ 3. Promise.allSettled on up to 4        │
 │    retrievers, filtered by `type`:      │
 │      semantic-video     (VSL + Mux)     │
 │      keyword-video      (VL tsvector)   │
 │      semantic-experience (EL)           │
 │      keyword-experience  (EL tsvector)  │
 │ 4. unwrapOutcome → labeled lists        │
 │ 5. fuseRankedLists(nonEmpty, k=60)      │
 │ 6. deduplicateResults(offset+limit+1)   │
 │ 7. slice(offset, offset+limit)          │
 │ 8. mapToSearchResult                    │
 └──────┬──────────────────────────────────┘
        ▼
{ results, hasMore, query, searchMode }
```

### RRF key shape

```
compound identity key:  `${resultType}:${resultId}`
  — keeps video-4 and experience-4 distinct in the score/props maps
  — resultId is admin's cuid string (not int like cms), change
    propagates through the `RankedItem`/`FusedResult` types
```

### Response contract (unchanged from cms)

```
{
  results: Array<{
    type:         "video" | "experience",
    id:           string,           // cuid (was int in cms)
    slug:         string,
    title:        string,
    imageUrl:     string | null,    // always null for experience in R4
    snippet:      string,
    startSeconds: number | null,    // null for experience + keyword-only video
    playbackId:   string | null,    // null for experience + keyword-only video + no-dub-match video
    score:        number            // RRF score, normalized [0,1], rounded 3dp
  }>,
  hasMore:    boolean,
  query:      string,
  searchMode: "hybrid" | "keyword-only"
}
```

**Type-compat note:** cms's `id` is `number` (Strapi SERIAL); admin's
is `string` (cuid). apps/web + apps/mobile consumer types must accept
both during the R3→R8 window. This is already true in practice
because R3's experience-content-dump migrated the experiences corpus
to cuid-shaped ids before admin exposed it anywhere consumer-facing.
Confirm with apps/web's `SearchResult` type at cutover.

## Implementation Units

- [ ] **Unit 1: Shared SQL constants + tsvector GIN migration**

**Goal:** Single-source-of-truth TypeScript string literals for the
tsvector expressions used by keyword-video and keyword-experience,
plus a raw-SQL Prisma migration that creates matching GIN indexes.

**Requirements:** R8, R10

**Dependencies:** None.

**Files:**

- Create: `apps/admin/src/services/hybrid-search-sql.ts`
- Create: `apps/admin/prisma/migrations/0006_hybrid_search_gin/migration.sql`
- Test: `apps/admin/src/services/hybrid-search-sql.test.ts`

**Approach:**

- Export two `Prisma.sql` (or `Prisma.raw`) fragments — one each for the
  video-locale and experience-locale tsvector expression. Export the
  equivalent string form for the migration.
- Migration creates `CREATE INDEX IF NOT EXISTS video_locale_fulltext_search_idx`
  and `experience_locale_fulltext_search_idx` using GIN on the exact
  expression. No function-based wrapper; direct expression index.
- Test asserts the TS constant and the migration SQL string are
  character-for-character identical (guards against silent index
  bypass when a future edit touches one but not the other).

**Patterns to follow:**

- Raw-SQL migration convention already used for the `0001_init`
  vector index + `0005` cms_document_id partial index.

**Test scenarios:**

- SQL constant matches migration byte-equal.
- Expression handles `coalesce(title,'')` + space + `coalesce(description,'')`
  consistently for both corpora.

**Verification:**

- `pnpm --filter @forge/admin prisma migrate diff` shows no pending
  drift after running the new migration against a dev DB.
- `EXPLAIN` on a probe query against `video_locale` shows `Bitmap Index
Scan on video_locale_fulltext_search_idx`.

---

- [ ] **Unit 2: Fusion + dedup primitives**

**Goal:** Port cms's RRF + 3-layer video dedup to admin as
type-parameterised helpers that work with admin's string ids and
Prisma-native types.

**Requirements:** R1

**Dependencies:** None.

**Files:**

- Create: `apps/admin/src/services/hybrid-search-fusion.ts`
- Test: `apps/admin/src/services/hybrid-search-fusion.test.ts`

**Approach:**

- Export `RankedItem` + `FusedResult` types. `resultId: string` (not
  `number` as in cms — admin uses cuids).
- `fuseRankedLists(lists, k=60)` — compound-key scoring, property merge
  (earlier lists win on overlapping keys), normalization by
  `lists.length / (k + 1)`, descending score sort.
- `deduplicateResults(results, limit)` — 3-layer video-only dedup
  (coreId prefix, exact title, `cosineSimilarityFromText` > 0.95).
  Non-video rows pass the 3 checks and only obey the limit cap.
- `cosineSimilarityFromText(a, b)` — verbatim parser of pgvector text
  format.

**Patterns to follow:**

- `apps/cms/src/api/search/services/fusion.ts` is the line-by-line
  reference. Algorithm is portable; the only diff is `resultId` typing.

**Test scenarios:**

- Fuses 1, 2, 3, 4 lists with overlapping and non-overlapping keys.
- Normalization denominator matches expected `n/(k+1)`.
- Property merge: earlier list's non-null field wins when later list
  has non-null for same key.
- Empty lists return empty fused list.
- 3-layer dedup: coreId prefix (`"4_X"` vs `"4_XAD"`), title exact
  match, cosine similarity > 0.95, mix of all three.
- Experience rows bypass dedup checks but still obey limit cap.
- `cosineSimilarityFromText` handles mismatched lengths, empty strings,
  zero vectors (returns 0 without NaN).

**Verification:**

- Unit tests cover each branch in cms's fusion.test.ts ported to admin.
- `/embed|vector|similarit/i` schema.test guard still passes (no new
  GraphQL types in this unit).

---

- [ ] **Unit 3: Four SQL retrievers**

**Goal:** Implement the 4 retrieval functions that feed the orchestrator.
Each produces a ranked `RankedItem[]` for one corpus × one modality.

**Requirements:** R7, R8, R9, R10

**Dependencies:** Units 1 (SQL constants + GIN index) + 2 (types).

**Files:**

- Create: `apps/admin/src/services/hybrid-search-retrievers.ts`
  — contains `searchVideoSemantic`, `searchVideoKeyword`,
  `searchExperienceSemantic`, `searchExperienceKeyword` as four
  exports.
- Test: `apps/admin/src/services/hybrid-search-retrievers.test.ts`

**Approach:**

- Each retriever is a thin `prisma.$queryRaw` caller returning
  RankedItem-shaped rows with corpus-specific extra keys (scene-level
  snippet + timecode for semantic-video, rank score for keyword, etc.).

**Technical design** _(directional — not implementation spec):_

```
searchVideoSemantic(prisma, {queryEmbedding, locale, limit})
  SQL: over video_scene_locale <=> ?::vector
       DISTINCT ON (vs.video_id)
       JOIN video_scene vs ON vs.id = vsl.video_scene_id
       JOIN video v ON v.id = vs.video_id AND v.deleted_at IS NULL
       JOIN video_locale vl ON vl.video_id = v.id
            AND vl.locale = ? AND vl.status = 'PUBLISHED'
       LEFT JOIN LATERAL (
         SELECT mv.playback_id
         FROM video_dub vd
         JOIN language lg ON lg.id = vd.language_id AND lg.bcp_47 = ?
         LEFT JOIN mux_video mv ON mv.id = vd.mux_video_id
         WHERE vd.video_edition_id = vs.video_edition_id
         ORDER BY vd.published DESC NULLS LAST
         LIMIT 1
       ) dub_mux ON true
       WHERE vsl.embedding IS NOT NULL AND vsl.locale = ?
       ORDER BY vs.video_id, vsl.embedding <=> ?::vector
       outer-ranked: ORDER BY similarity DESC LIMIT ?
  Returns: { resultType:"video", resultId:videoId, videoId, videoCoreId,
             videoSlug, videoTitle (from VideoLocale.title),
             imageUrl:null (Unit 3 parity, images TBD), description,
             startSeconds, playbackId, similarity, embeddingText }

searchVideoKeyword(prisma, {query, locale, limit})
  SQL: DISTINCT ON (v.id) over video_locale tsvector
       JOIN video v, filter status='PUBLISHED', locale=?
       WHERE <tsvector-expr> @@ plainto_tsquery('simple', ?)
             AND v.deleted_at IS NULL
       Uses hybrid-search-sql.ts SQL constant
       Returns keyword-shaped RankedItem (no startSeconds/playbackId).

searchExperienceSemantic(prisma, {queryEmbedding, locale, limit})
  SQL: SELECT el.id, e.*, el.title, el.meta_description,
              1 - (el.embedding <=> ?::vector) AS similarity
       FROM experience_locale el
       JOIN experience e ON e.id = el.experience_id AND e.archived_at IS NULL
       WHERE el.embedding IS NOT NULL
         AND el.locale = ? AND el.status = 'PUBLISHED'
       ORDER BY el.embedding <=> ?::vector LIMIT ?
  Returns: { resultType:"experience", resultId:experienceLocaleId,
             experienceSlug, experienceTitle,
             experienceMetaDescription, imageUrl:null, similarity }

searchExperienceKeyword(prisma, {query, locale, limit})
  SQL: over experience_locale tsvector (matches GIN index from Unit 1)
       JOIN experience e ON e.id = el.experience_id AND e.archived_at IS NULL
       WHERE status='PUBLISHED' AND locale=? AND tsvector @@ plainto_tsquery
```

- All retrievers short-circuit on empty-after-trim inputs (`query` or
  `queryEmbedding`) without hitting the DB.
- Each retriever receives `prisma` (Prisma client with extension), but
  uses `$queryRaw` directly so the embedding-strip extension is not in
  the path.
- Row-level post-processing maps snake_case Postgres columns to
  camelCase RankedItem props; no field renaming beyond that.

**Patterns to follow:**

- `apps/cms/src/api/search/services/{semantic,keyword,experience-*}.ts`
  for SQL shape.
- `apps/admin/src/services/experience.search.ts` for the `$queryRaw`
  - `toPgVector` + transaction-scoped SET LOCAL pattern (R4 retrievers
    do NOT need `SET LOCAL ef_search` — single-shot search with cms's
    existing HNSW defaults is the parity target).

**Test scenarios:**

- Each retriever against seeded DB: empty query → `[]` short-circuit.
- Locale filter excludes rows in a different locale.
- `status != PUBLISHED` rows excluded.
- `archived_at IS NOT NULL` experience excluded.
- Semantic-video LEFT JOIN LATERAL returns null `playbackId` when no
  matching `(edition, locale)` dub exists, and the video still
  appears in results.
- Semantic-video embedding mismatch on another locale excluded when
  `vsl.locale = ?` is applied.

**Verification:**

- Each retriever's query plan uses the HNSW index (semantic) or GIN
  index (keyword). Confirm with `EXPLAIN ANALYZE`.
- All retrievers return rows sorted by their natural score
  (similarity or ts_rank) descending.

---

- [ ] **Unit 4: Search health counters + withTimeout helper**

**Goal:** Port `search-health.ts` verbatim (module-scope counters

- `recordAttempt`/`recordFailure`/`getStats`/`withTimeout`/
  `__resetSearchHealthForTest`).

**Requirements:** R6

**Dependencies:** None.

**Files:**

- Create: `apps/admin/src/services/hybrid-search-health.ts`
- Test: `apps/admin/src/services/hybrid-search-health.test.ts`

**Approach:**

- Module-scope mutable state (scoped to the Node.js process). Reset
  helper is test-only.
- `withTimeout` returns a `Promise<T>` that rejects with an
  `Error(`Timed out after ${ms}ms`)` if the wrapped promise doesn't
  settle in time.

**Patterns to follow:**

- `apps/cms/src/api/search/services/search-health.ts` — line-by-line
  copy.

**Test scenarios:**

- Counters increment on attempt + failure.
- `getStats()` returns a snapshot not a live reference.
- `withTimeout` rejects before the inner promise settles when the
  timeout fires first.
- `withTimeout` propagates inner resolution when inner wins.

**Verification:**

- Unit tests pass; counters reset correctly between tests via
  `__resetSearchHealthForTest`.

---

- [ ] **Unit 5: HybridSearchService orchestrator**

**Goal:** The `search(params)` orchestrator — the only callable
surface that the REST handler and Pothos resolver invoke. Contains
all the cross-cutting logic (embed-or-degrade, allSettled, RRF,
dedup, paginate, map-to-response-contract).

**Requirements:** R1, R2, R3, R5, R7, R9

**Dependencies:** Units 2, 3, 4.

**Files:**

- Create: `apps/admin/src/services/hybrid-search.service.ts`
- Test: `apps/admin/src/services/hybrid-search.service.test.ts`

**Approach:**

- Class or factory that accepts a `PrismaClient` at construction
  (matching admin convention — `apps/admin/src/services/experience.search.ts`).
- Exports `search(params: SearchParams): Promise<SearchResponse>` plus
  the exported constants (`RRF_K=60`, `DEFAULT_LIMIT=20`,
  `MAX_LIMIT=50`, `OVERFETCH_FACTOR=3`).
- `searchMode: "hybrid" | "keyword-only"` derived from whether the
  embedding call succeeded.
- Maps fused results to `SearchResult` via `mapToSearchResult` — null
  `imageUrl` for experiences and for scene-less video rows, null
  `startSeconds`/`playbackId` for non-semantic video rows.

**Patterns to follow:**

- `apps/cms/src/api/search/services/search.ts` — preserve the step
  comments 1–5 as service-level comments so the port is legible.

**Test scenarios:**

- Empty `q` after trim → empty results + `hasMore: false` (no
  retrievers invoked).
- Embedding succeeds → all 4 retrievers invoked when `type` omitted;
  response `searchMode === "hybrid"`.
- Embedding throws (simulate via DI-injected embedder stub) →
  semantic retrievers skipped, keyword retrievers run, response
  `searchMode === "keyword-only"`, counters incremented via the
  health module, structured `event=query_embedding_failure` error
  log emitted.
- `contentTypes: ["video"]` → only video retrievers invoked.
- `contentTypes: ["experience"]` → only experience retrievers invoked.
- `contentTypes: []` or undefined → both (4-retriever default).
- One retriever rejects → `allSettled` unwraps others; logged error
  line contains the retrieval label; final response excludes the
  failed corpus.
- Pagination: `offset=20, limit=20` on a 30-result deduped set →
  `results.length=10, hasMore=false`.
- `limit` clamped to MAX (50) when caller passes 100; `limit` defaults
  to 20 when missing; `limit=0` clamps to 1 (tracked by cms).

**Verification:**

- Unit tests cover every branch of cms's `search.ts` with admin types.
- `/embed|vector|similarit/i` schema guard unaffected (no new Pothos
  types in this unit).

---

- [ ] **Unit 6: REST route handlers + rate limiting**

**Goal:** `GET /api/search` and `GET /api/search/health` exposed as
Next App Router route handlers that wrap the service with query-param
parsing, rate-limit enforcement, and cms-compatible HTTP semantics.

**Requirements:** R2, R4, R6

**Dependencies:** Units 4, 5.

**Files:**

- Create: `apps/admin/src/app/api/search/route.ts`
- Create: `apps/admin/src/app/api/search/health/route.ts`
- Test: `apps/admin/src/app/api/search/route.test.ts`
- Test: `apps/admin/src/app/api/search/health/route.test.ts`

**Approach:**

- `/api/search`:
  - Parse `URL(request.url).searchParams`: `q` (required, trimmed), `locale`
    (required), `type` (optional, validated), `limit`, `offset`.
  - `rateLimitAuthRoute({request, route:"search", limit:30,
windowMs:60_000})` gate; 429 when denied.
  - 400 on missing `q` / missing `locale` / invalid `type`.
  - Call `hybridSearchService.search(params)`, return 200 JSON.
  - 503 on unexpected orchestrator throw (error logged).
- `/api/search/health`:
  - `rateLimitAuthRoute({route:"search-health", limit:5,
windowMs:60_000})`.
  - `recordAttempt()` → `withTimeout(embedQueryText("health probe"),
5000)` → `getStats()` → HTTP 200 JSON `{status:"ok"|"degraded",
error, …getStats()}` (always 200, per cms parity).

**Patterns to follow:**

- `apps/admin/src/app/api/auth/[...all]/route.ts` for
  `rateLimitAuthRoute` usage.
- `apps/admin/src/app/api/health/route.ts` for the bare JSON
  response shape (but R4's health endpoint returns a richer body).

**Test scenarios:**

- `/api/search` missing `q` → 400 with cms-compatible body
  `{error: "q (search query) is required"}`.
- Missing `locale` → 400 `{error: "locale is required"}`.
- Invalid `type=foo` → 400 `{error: "type must be 'video' or 'experience'"}`.
- `type=video` → service invoked with `contentTypes:["video"]`.
- Rate-limit denial → 429.
- Health probe success path → 200 `{status:"ok", error:null,
attempts, failures, …}`.
- Health probe timeout path → 200 `{status:"degraded", error:"Timed
out after 5000ms", …}` with failures++ and an
  `event=health_probe_failed` error log.
- Health probe rate-limit bucket is separate from search bucket
  (stressing search does not exhaust health budget).

**Execution note:** Start with a failing integration test for the
response contract (parity with cms) before wiring the handler.
Consumer-contract compatibility is what this unit actually buys.

**Verification:**

- Response JSON diffs against cms's for the same query (within
  data-model differences). Byte-level diff on error bodies.
- Route handler exported as `GET` and the Next build succeeds.

---

- [ ] **Unit 7: GraphQL `search` public query field**

**Goal:** Expose the same service via a Pothos query field named
`search`, returning an object type with the same response shape as
REST.

**Requirements:** R3

**Dependencies:** Unit 5.

**Files:**

- Create: `apps/admin/src/graphql/types/hybrid-search.ts`
  — defines `SearchResultItem`, `SearchResponse`, `ContentTypeFilter`
  types (non-prismaObject; `builder.objectType` / `builder.enumType`).
- Create: `apps/admin/src/graphql/queries/hybrid-search.ts` — Pothos
  `search(q, locale, type, limit, offset)` query field.
- Modify: `apps/admin/src/graphql/schema.ts` — add side-effect
  imports for the new types/queries file (matches the existing
  admin convention documented in `apps/admin/CLAUDE.md`).
- Test: `apps/admin/src/graphql/queries/hybrid-search.test.ts` —
  DB-backed test that runs the query against a seeded corpus.
- Modify: `apps/admin/src/graphql/schema.test.ts` — add assertions
  that `SearchResultItem` has no `embedding|vector|similarit`-shaped
  fields and `score` is `Float` (not `embedding_score` or similar).

**Approach:**

- `authScopes: { public: true }`, matching the existing
  `searchExperiences` field.
- Args validated in-resolver: `q` required, `locale` required, `type`
  optional enum.
- Resolver returns the `SearchResponse` from the service directly —
  the object type's field list mirrors the REST JSON.
- `ContentTypeFilter` enum: `VIDEO | EXPERIENCE` (match the REST
  lowercase values via `@values`-style mapping if needed; cms doesn't
  have a GraphQL enum so we're the first to define it).
- Test runs `search(q:"…", locale:"en")` and asserts the same object
  returned by a direct service call (shared fixtures).

**Patterns to follow:**

- `apps/admin/src/graphql/queries/search.ts` — auth scope + arg shape.
- `apps/admin/src/graphql/types/experience.ts` — classification
  JSDoc comment (`@classification public-shape`) applies; the new
  types are not ABAC-gated (no Prisma relation to an abac-gated
  type).

**Test scenarios:**

- Query with `q + locale` returns fused results.
- Query with `type: VIDEO` restricts corpus.
- PUBLIC role succeeds (no scope-auth rejection).
- `limit` clamps at 50; over-cap requests return 50 results max.
- `searchMode` enum surfaced as `"hybrid"` / `"keyword-only"`.

**Verification:**

- `pnpm --filter @forge/admin typecheck` passes.
- `pnpm --filter @forge/admin test schema.test` passes with the new
  assertions.

---

- [ ] **Unit 8: CLAUDE.md + solutions doc**

**Goal:** Capture R4 as a durable section of `apps/admin/CLAUDE.md`
(sibling to R1/R2/R3 sections) and write a learnings doc with the
pattern summary.

**Requirements:** Playbook's Cross-Cutting Constraints + "After
completing work" compound-engineering loop.

**Dependencies:** Units 1–7.

**Files:**

- Modify: `apps/admin/CLAUDE.md` — append a "## Hybrid search (R4 of
  admin migration playbook)" section after the R3 "Experience content
  dump" section.
- Create:
  `docs/solutions/platform/admin-hybrid-search-r4-pattern.md`.

**Approach:**

- CLAUDE.md section mirrors the R1/R2/R3 shape: Schema, Services,
  Orchestrator, Endpoints, Operational runbook. Cite the
  `hybrid-search.service.ts` + both route handlers + the new GraphQL
  `search` field by exact file path.
- Solutions doc captures the non-obvious bits: tsvector-expression
  byte-parity with the GIN index, three-hop Mux playbackId join,
  `generateExperienceEmbedding` reused as a generic embedder,
  `imageUrl:null` parity decision with a pointer to the follow-up
  upgrade, `embedding::text` transport is service-internal.

**Patterns to follow:**

- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  — structure reference (R1 pattern doc).
- `docs/solutions/platform/admin-experience-content-dump-pattern.md`
  — structure reference (R3 pattern doc).

**Test scenarios:**

- N/A (docs).

**Verification:**

- CLAUDE.md renders without broken links.
- Solutions doc's filename matches the `admin-*-pattern.md` convention.

## System-Wide Impact

- **Interaction graph:** REST `/api/search` is a new public surface.
  No conflict with existing `/api/graphql`, `/api/health`, `/api/auth`,
  `/api/preferences`, `/api/workflows`. GraphQL `search` is a new
  public root field; no relation to abac-gated types (confirmed by
  schema classification test).
- **Error propagation:** Embedding failure degrades to keyword-only
  (logged, counter incremented). Retriever failure degrades per-list
  (logged, list replaced by `[]`). Orchestrator failure → REST 503,
  GraphQL error. Rate-limit denial → REST 429, GraphQL throttle error.
- **State lifecycle risks:** None — R4 is read-side. Health counters
  are process-local; no durable state.
- **API surface parity:** cms's `/api/search` response must match
  byte-for-byte (except id typing, which consumers already tolerate
  post-R3). GraphQL exposure is net-new; no prior consumer to break.
- **Integration coverage:** Unit tests with seeded DB cover each
  retriever; service-level tests cover orchestration; route-handler
  tests cover HTTP semantics; GraphQL test covers schema + public
  auth. A live-fire preview-environment canary diff vs cms is the
  top-of-stack sanity check.

## Risks & Dependencies

- **HNSW planner bypass when `vsl.locale = ?` filter widens.** cms's
  per-locale partial indexes (R1 pattern) already mitigate this.
  Confirm admin's 0003 migration created per-locale partial indexes;
  if not, R4 may need an index addendum. _Deferred to implementation._
- **tsvector-expression drift.** A future edit that changes the
  service constant but not the migration (or vice versa) silently
  reverts to sequential scan on large corpora. Mitigated by the byte-
  equality unit test in Unit 1.
- **`generateExperienceEmbedding` name ambiguity.** A future
  engineer may assume it's experience-specific and add a second
  generic embedder. Mitigated by the learnings doc + an optional
  re-export alias. _Rename is a follow-up; not blocking R4._
- **Rate-limit false positives for CI / QA canary diff traffic.**
  Preview environment rate caps may throttle a scripted diff across
  hundreds of queries. Implementer should exempt preview or bump the
  cap when running the canary.
- **`VideoDub` LATERAL subquery cost at scale.** Worth an `EXPLAIN`
  sanity check on a full-size prod-analogue DB; should be cheap with
  the `(video_edition_id, language_id)` indexes already present.
- **Data readiness dependencies from R1/R2/R3 prod backfills.** R1
  scene backfill is still gated on Doppler `CMS_DATABASE_URL` + the
  read-only PG role. Until those land, admin's `video_scene_locale`
  has few/no rows, so semantic-video returns `[]` and RRF degrades to
  a 3-list fusion. Not a blocker for shipping R4 code or tests.

## Documentation / Operational Notes

- **Runbook:** `/api/search/health` is the pollable surface. External
  monitors (Railway healthcheck, uptime tools) can be pointed at
  `https://admin.jesusfilm.org/api/search/health`; body's `status`
  field is the machine-readable signal. Counters reset on process
  restart; monitors compute deltas across replicas as they see fit.
- **Rollout:** Deploy to preview → run canary diff vs cms for a fixed
  query set × locales → merge to main. Cutover of apps/web +
  apps/mobile to admin's endpoint is NOT part of R4 (that's R8).
- **Monitoring:** Structured log lines
  `[search] event=query_embedding_failure error_class=… message=…`
  and `[search] event=health_probe_failed …` let log-based alerting
  catch the feat-097-class regression that R4 inherits the fix for.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-23-admin-hybrid-search-r4-requirements.md](../brainstorms/2026-04-23-admin-hybrid-search-r4-requirements.md)
- **Playbook:** [docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md](../brainstorms/2026-04-19-admin-migration-playbook-requirements.md)
- **cms source impl:** `apps/cms/src/api/search/` (services, controllers, routes)
- **admin precedent:** `apps/admin/src/services/experience.search.ts`,
  `apps/admin/src/services/embeddings.service.ts`,
  `apps/admin/src/auth/rate-limit.ts`,
  `apps/admin/src/graphql/queries/search.ts`
- **Learnings:**
  - `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  - `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`
  - `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  - `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`
  - `docs/solutions/platform/admin-experience-content-dump-pattern.md`
- **Related feats:** feat-010 (hybrid retrieval), feat-086 (experience
  search), feat-097 (search hardening), feat-104 (R1 scene embeddings).
