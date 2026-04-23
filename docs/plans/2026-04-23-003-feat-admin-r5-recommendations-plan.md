---
title: feat(admin) — R5 scene-recommendations API + Recommendations block schema
type: feat
status: active
date: 2026-04-23
origin: docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md
---

# feat(admin) — R5 scene-recommendations API + Recommendations block schema

## Overview

Port `apps/cms`'s scene-similarity recommendation query (feat-044) into
`apps/admin`. Adds a new shared `SceneRecommendationsService`, a public
REST endpoint at `GET /api/scene-embedding/recommendations` (singular, to
match cms byte-for-byte), and a public Pothos `sceneRecommendations`
GraphQL query. Also adds a forward-looking `videoRecommendations` variant
to admin's Zod `BlockSchema` (schema only, no editor UX).

R5 is the read-side sibling of R4 (hybrid search). It reuses R4's
patterns — shared service called by REST + GraphQL, `rateLimitAuthRoute`
for the REST front door, cms-parity-first SQL re-derivation against
admin's per-locale schema, and the 3-layer video dedup. Extracts the
dedup primitive into a shared util so R4 and R5 stay in lockstep.

Together with R4, R5 closes out the public consumer-contract coverage
that R8 (one-shot apps/web + apps/mobile cutover) depends on.

## Problem Frame

apps/cms owns `GET /api/scene-embedding/recommendations` (REST) and the
`sceneRecommendations(slug, locale, limit)` public GraphQL query
(cf. `apps/cms/src/graphql/recommendations.ts`). apps/web's
recommendations block calls the GraphQL query verbatim via a raw `gql`
tag in `apps/web/src/lib/recommendations.ts`. For the R8 one-shot client
swap to work, admin must expose the same endpoint surface with the same
response shape (modulo the cms-int → admin-cuid identity tension that R4
already resolved the same way for search result ids).

No product decisions outstanding (per the origin's "Resolve Before
Planning" list — empty). All open questions are technical and resolved
below.

## Requirements Trace

- **R5.1** — REST endpoint at `GET /api/scene-embedding/recommendations`
  matching cms's contract byte-for-byte: query params `videoId`, `slug`,
  `locale` (required), `sceneIndex?`, `limit?` (default 10, max 50).
  Response: `{ recommendations: SceneRecommendation[] }`. Status codes:
  400 bad request, 404 not-found (unknown videoId/slug), 429 rate limit,
  503 service unavailable. Public (no auth).
  _(see origin §Requirements R5)_
- **R5.2** — Public Pothos `sceneRecommendations(videoId, slug, locale,
sceneIndex, limit)` query returning `[SceneRecommendation!]!` with
  identical field names to cms's GraphQL type. `authScopes: { public:
true }` like R4's `search` query.
- **R5.3** — 3-layer video deduplication (coreId prefix, exact title,
  embedding cosine > 0.95) with 3x overfetch, reusing the primitive from
  R4 rather than duplicating.
- **R5.4** — Per-scene (input is `(videoId | slug, sceneIndex)`) and
  per-video (input is `(videoId | slug)` alone) modes. Per-video merges
  best-similarity-per-candidate across each input scene's top-N before
  the final dedup + limit.
- **R5.5** — Locale-aware filtering via admin's 3-hop
  `VideoDub (edition, language) → MuxVideo` chain (re-derived from R4's
  retrievers).
- **R5.6** — Exclude self + all parent/child videos from results using
  admin's `VideoRelation` table (parent/child graph).
- **R5.7** — Add a `videoRecommendations` variant to admin's Zod
  `BlockSchema` in `src/domain/blocks.ts`. Schema only; no editor UX,
  no renderer, no migration.
- **R5.8** — schema.test.ts continues to pass the
  `/embed|vector|similarit/i` leak guard. New response types must not
  expose any embedding-shaped field (similarity is allowed, it's a
  computed float that already appears on cms's sceneRecommendations).

## Scope Boundaries

- **No editor UX** for the Recommendations block. Schema only; the
  authoring surface is tatai's downstream feat-100/103 work.
- **No `apps/web` renderer changes** in this PR. The existing renderer
  at `apps/web/src/components/sections/VideoRecommendations.tsx` stays
  unchanged; apps/web's cutover is R8 scope. One known parity delta
  (videoId: number → string) gets documented in the plan but not
  applied now.
- **No R6 personalization** — FPMC, Two-Tower, cold-start,
  `recommendation_impressions` table, watch-event ingestion, A/B logging
  are R6 scope and not in this PR.
- **No 5th RRF list for transcript embeddings.** R2 indexed transcripts,
  but fusing them into recommendations is a post-R8 follow-up.
- **No `apps/cms` changes** beyond reading source during porting.
- **No hardcoded locale/language defaults.** Data-derived only; empty
  results on a locale with no corpus are a legitimate signal, not a bug
  to paper over with an `en` fallback (cf.
  `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md`).
- **No decommissioning of cms's recommendation endpoint.** R8/R9/R10
  territory. cms keeps serving until the consumer cutover flips.
- **No embedding regeneration.** Recommendations read from
  R1-indexed `VideoSceneLocale.embedding`. If R1's prod backfill is
  incomplete when R5 ships, recommendations on those locales return
  fewer rows than cms — a legitimate data-readiness signal per the
  playbook's "canary diffs will reveal this" note.
- **No R4 follow-up bundling.** Experience `imageUrl` wiring,
  transcript-embedding RRF, `generateExperienceEmbedding` rename are
  explicitly outside R5.

## Context & Research

### Relevant Code and Patterns

**cms source (port from):**

- `apps/cms/src/api/scene-embedding/services/recommender.ts` — the
  reference implementation. `getRecommendations`, `VideoNotFoundError`,
  `SceneRecommendation`, 3-layer `deduplicateResults`, `OVERFETCH_FACTOR
= 3`, `MAX_LIMIT = 50`, per-scene vs per-video modes,
  `getRelatedVideoIds` (self + parent + child), `resolveSlugToId`.
- `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts`
  `recommendations` handler — REST query-param contract + HTTP envelope.
- `apps/cms/src/api/scene-embedding/routes/scene-embedding.ts` — REST
  path is `/scene-embedding/recommendations` (singular).
- `apps/cms/src/graphql/recommendations.ts` — SDL and resolver contract
  for the public `sceneRecommendations` query.

**apps/web consumer contract (byte-parity target):**

- `apps/web/src/lib/recommendations.ts` — calls
  `sceneRecommendations(slug, locale, limit)` only (never sends
  `videoId` or `sceneIndex`). Raw `gql` tag so the cutover swap is a
  URL change plus one field-type tweak on the `SceneRecommendation`
  TypeScript type.
- `apps/web/src/components/sections/VideoRecommendations.tsx` — uses
  `rec.videoId` only as a React key (`${rec.videoId}-${rec.sceneIndex}`)
  and `rec.videoSlug` for the href. Safe against a number→string
  identity swap.

**admin patterns to mirror (R4's siblings):**

- `apps/admin/src/services/hybrid-search.service.ts` — shared service
  entry point pattern called by REST + GraphQL.
- `apps/admin/src/app/api/search/route.ts` — REST handler with
  `rateLimitAuthRoute` + 400/429/503 error envelope.
- `apps/admin/src/services/hybrid-search-retrievers.ts` — the
  `VideoSceneLocale` + `video_locale.status='published'` +
  `video.deleted_at IS NULL` + 3-hop
  `VideoDub → language.bcp47 = locale → MuxVideo` LATERAL playback
  lookup. R5 re-derives the scene-similarity query against the same
  schema; the one delta is INNER JOIN (not LEFT JOIN) on the dub/mux
  chain to preserve cms's `playbackId: String!` guarantee.
- `apps/admin/src/services/hybrid-search-fusion.ts` — current home of
  `deduplicateResults` + `cosineSimilarityFromText`. R5 extracts these
  into a shared util.
- `apps/admin/src/graphql/queries/hybrid-search.ts` — public Pothos
  query registration pattern (`authScopes: { public: true }`,
  no-embedding-leak test coverage).

**admin Prisma schema anchors:**

- `VideoScene` — attaches to `VideoEdition`, unique on
  `(videoEditionId, sceneIndex)`, carries `startSeconds` / `endSeconds`
  / `chapterTitle` but **not** themes. Also carries `videoId` FK.
- `VideoSceneLocale` — per-locale `description` + `embedding
vector(1536)` + array columns `themes`, `bibleVerses`, `demographics`,
  `spiritualContext`. This is where the response arrays come from
  (cms had them on `scene_embeddings`; admin moved them to per-locale
  rows because text content is language-specific).
- `Video` — has `slug` (string) + `coreId` + `deletedAt`.
- `VideoLocale` — has `title` + `description` + `status`.
- `VideoRelation` — parent/child graph. Columns: `parentId`,
  `childId`. Replaces cms's `videos_children_lnk`.
- `VideoDub` + `MuxVideo` + `Language` — the 3-hop playback chain R4
  already wires.

### Institutional Learnings

- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md` — R4
  durable learnings; most apply unchanged (shared service + two front
  doors, cms-parity-first SQL, no embedding leak via GraphQL).
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md` —
  every SQL invariant must be re-derived from admin's schema. R5's
  delta list vs. cms: `scene_embeddings` (single cms row) →
  `video_scene + video_scene_locale` (admin two-table split);
  `videos.title` → `video_locale.title`; `video_variants` publish chain
  → `VideoLocale.status + Video.deleted_at`; `video_images` LATERAL
  → dropped (imageUrl null for R5, same stance as R4 for experiences);
  `se.playback_id` (stored directly) → 3-hop dub lookup; `videos_children_lnk`
  → `VideoRelation`.
- `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md` —
  no hardcoded locale list. `locale` is a required boundary parameter;
  zero-result responses are legitimate data signals.
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md` —
  **does NOT apply.** R5 is a synchronous read-side port with no
  `start()` call site. Flagged to keep the learning doc's scope clear.

### External References

None required. R5 is a port grounded in cms + admin local source; no
external framework guidance needed.

## Key Technical Decisions

1. **REST path is `/api/scene-embedding/recommendations` (singular).**
   cms's actual path is singular despite the playbook's plural
   reference. Byte-parity > following the playbook's typo; flagged
   back to the playbook for future audits.
2. **Identity delta: `videoId: ID!` (admin cuid string) replaces cms's
   `Int!`.** apps/web consumes `videoId` only as a React key and never
   sends it as an input — so the parity break is a one-line
   TypeScript-type change on `apps/web/src/lib/recommendations.ts`'s
   `SceneRecommendation` (documented here, applied at R8 cutover, not
   now). Same class of delta as R4's cuid `resultId`.
3. **Input `videoId` (GraphQL arg) and `videoId` (REST query param) are
   also `ID` / cuid string.** Either `videoId` or `slug` is required.
   Both accepted so internal pipeline consumers using cuid work without
   a slug lookup.
4. **Response `videoSlug` comes from `Video.slug`** (non-null in admin).
   `videoTitle` from `VideoLocale.title` coalesced to `""` (matches cms's
   `row.video_title ?? ""` behavior in `mapRow`).
5. **`imageUrl: null`** for R5 (cms parity stance inherited from R4).
   Wiring a real imageUrl from `VideoImage`/`MuxVideo` thumbnail is a
   post-cutover upgrade so the pre-R8 diff-against-cms invariant holds.
6. **`playbackId: String!` preserved via INNER JOIN** on the dub + mux
   chain. Rows without a resolvable playback are filtered out at SQL.
   This intentionally diverges from R4's search (LEFT JOIN, null
   allowed) because cms's recommender guarantees non-null and apps/web's
   renderer may rely on that. Rationale documented in the retriever
   docstring.
7. **`themes` / `demographics` / `spiritualContext` come from
   `VideoSceneLocale`** (admin's per-locale model), not from
   `VideoScene`. `bibleVerses` is also on the row but is not part of
   cms's response shape and is therefore not exposed. No schema change.
8. **3-layer dedup extracted to shared util.** New file
   `src/services/video-dedup.ts` exports
   `dedupeByVideoIdentity<T extends VideoDedupKeys>(rows, limit)` and
   `cosineSimilarityFromText`. `VideoDedupKeys` is a structural shape
   `{ resultType?: string; videoCoreId?: string | null; videoTitle?:
string | null; embeddingText?: string | null }`. R4's
   `hybrid-search-fusion.deduplicateResults` becomes a thin wrapper that
   calls the primitive (preserves its `FusedResult` signature; R4 tests
   unchanged). R5 calls the primitive directly on its row type.
9. **Per-scene resolution across multi-edition videos.** Admin's unique
   key is `(videoEditionId, sceneIndex)` — a single `(video, sceneIndex)`
   pair can resolve to multiple scene rows when a video has more than
   one edition. Deterministic rule: pick the primary edition (the one
   the video's primary `VideoDub` or canonical `VideoEdition` points to)
   by joining through the earliest `edition.created_at`. If the rule is
   non-obvious at implementation time, emit a `VideoNotFoundError` with
   a clear message rather than silently returning an ambiguous scene —
   deferred-to-implementation as a tie-break only.
10. **Slug resolution.** cms's `resolveSlugToId` went to `videos.slug`.
    Admin's `Video.slug` lives on the parent row directly. Match by
    `Video.slug = ? AND deleted_at IS NULL`.
11. **Exclude graph is self + parent + child via `VideoRelation`.**
    Single CTE: `SELECT ? AS id UNION SELECT parent_id FROM
video_relation WHERE child_id = ? UNION SELECT child_id FROM
video_relation WHERE parent_id = ?`. Mirrors cms's semantics.
12. **REST rate-limit bucket: `"recommendations"` at 30/min.** Matches
    R4's `"search"` bucket. Separate bucket so search traffic doesn't
    starve recommendation traffic or vice versa.
13. **Forward-looking Zod variant.** cms has no
    `ComponentBlocksVideoRecommendations` component — no Strapi file,
    no introspection type, no apps/web consumer. The variant is
    net-new, modeled after `VideoCarouselBlockSchema`. Minimum viable
    fields: `t: "videoRecommendations"`, `sectionKey`, `imageUrl?`,
    `backgroundColor?`, `title?`, `subtitle?`, `description?`,
    `sourceVideoId?` (omitted = route video per a future
    `useRouteVideo`-style convention; not introduced in R5),
    `sourceSceneIndex?`, `limit` with a sane default. Added to the
    top-level `BlockSchema` union only (not to
    `SectionContentBlockSchema` — recommendations sit at the top level
    like `VideoCarousel`).
14. **Service file lives under `src/services/scene-recommendations.service.ts`.**
    Retrievers live alongside: `src/services/scene-recommendations-retriever.ts`
    (single retriever — no 4-list fusion to separate). Fewer files
    than R4's hybrid-search layout; warranted by the narrower surface.
15. **Response envelope: `{ recommendations: [...] }`** for REST. cms
    uses the same envelope (`ctx.body = { recommendations: results }`).
    GraphQL returns a bare list (`[SceneRecommendation!]!`) — same
    contract as cms's SDL.

## Open Questions

### Resolved During Planning

- **How does apps/web call the recommendations endpoint today?**
  Resolved: via GraphQL, passing `(slug, locale, limit)` only. videoId
  never sent. sceneIndex never sent. Per-video mode is the only one
  exercised by apps/web today; per-scene mode survives for internal
  pipeline consumers.
- **Does admin's `ComponentBlocksVideoRecommendations` have a cms
  precedent?** Resolved: no. Strapi `components/sections/` directory has
  no file. packages/graphql introspection has no type. R5 defines the
  Zod variant from scratch using `VideoCarouselBlockSchema` as the
  template.
- **How are themes/demographics/spiritualContext modeled in admin?**
  Resolved: on `VideoSceneLocale` (per-locale `String[]` with `default([])`),
  not on `VideoScene`. Admin correctly moved them per-locale since they
  derive from language-specific text analysis.
- **How to reuse R4's dedup without dragging in `FusedResult + score`?**
  Resolved: extract a structural `dedupeByVideoIdentity` primitive plus
  `cosineSimilarityFromText` to `src/services/video-dedup.ts`. R4's
  `deduplicateResults` becomes a thin wrapper; existing R4 tests
  continue to pass.
- **Should R5 filter rows with null playbackId?** Resolved: yes, to
  preserve cms's `playbackId: String!` non-null contract. INNER JOIN on
  dub+mux.
- **What happens when `Video.slug` doesn't resolve?** Resolved: throw
  `VideoNotFoundError`. REST controller maps to 404. GraphQL resolver
  maps `VideoNotFoundError` → `[]` (matches cms's GraphQL resolver;
  the REST-vs-GraphQL divergence is intentional — GraphQL soft-fails
  so the recommendations block renders an empty state instead of a
  top-level error).

### Deferred to Implementation

- **Primary-edition tie-break rule for per-scene mode.** Defaulting to
  `min(video_edition.created_at)` as the deterministic pick, but the
  exact column / ordering will be validated against real data at
  implementation time. If ambiguity exists, `VideoNotFoundError` with a
  clear message is the escape hatch, not silent first-row-wins.
- **Exact `videoRecommendations` Zod field names.** Planned shape above
  is a skeleton; the final field names should match any in-flight
  conventions (e.g. if `sourceVideoId` has a sibling naming pattern
  `routeVideoId` or a toggle like `useRouteVideo`). No public consumer
  today so there's no renaming cost; final names settled at
  implementation-time grep against `VideoCarouselBlockSchema` /
  `MediaCollectionBlockSchema` siblings.
- **Apollo cache revalidation of apps/web's `unstable_cache` entry.**
  apps/web caches recommendations with a 60s revalidate. R5 doesn't
  touch apps/web, but R8's cutover PR should flag the cache-key
  (`scene-recommendations`) for invalidation on deploy so stale
  responses from cms don't leak into the first admin-backed page load.

## Implementation Units

- [ ] **Unit 1: Extract shared video-dedup primitive**

**Goal:** Move `deduplicateResults` + `cosineSimilarityFromText` out of
`hybrid-search-fusion.ts` into a reusable primitive keyed on the
minimal dedup shape, so both R4 and R5 consume it.

**Requirements:** R5.3.

**Dependencies:** None.

**Files:**

- Create: `apps/admin/src/services/video-dedup.ts`
- Create: `apps/admin/src/services/video-dedup.test.ts`
- Modify: `apps/admin/src/services/hybrid-search-fusion.ts` (thin
  wrapper that calls the primitive; keep the public `deduplicateResults`
  signature intact)
- Modify: `apps/admin/src/services/hybrid-search-fusion.test.ts` (no
  behavioral changes expected — existing assertions still pass)

**Approach:**

- Export `dedupeByVideoIdentity<T extends VideoDedupKeys>(rows, limit)`
  with a structural `VideoDedupKeys` interface (`resultType?`,
  `videoCoreId?`, `videoTitle?`, `embeddingText?`).
- `resultType === "video"` triggers the 3-layer check; other
  `resultType` values pass through (preserves R4's experience-rows
  behavior exactly).
- Rows with no `resultType` (R5's direct use) default to treating every
  row as `"video"` — R5 only ever calls this on recommendation rows
  which are all videos.
- Move `cosineSimilarityFromText` unchanged.
- R4's `deduplicateResults` re-exports the primitive or wraps it 1:1.

**Patterns to follow:**

- Existing `hybrid-search-fusion.ts` docstring style.
- Test shape: pre-sorted input, assert dedup order and the 3 layers
  independently (existing R4 tests cover this pattern).

**Test scenarios:**

- `resultType: "video"` rows dedup via coreId prefix, exact title, and
  embedding cosine > 0.95.
- Missing `resultType` (R5 row shape) still triggers video dedup.
- Non-video `resultType` rows pass through untouched.
- Empty input returns empty output.
- Limit cap stops collection before all uniques are seen.

**Verification:**

- `pnpm --filter @forge/admin test video-dedup` passes.
- Existing `hybrid-search-fusion.test.ts` passes without changes.
- typecheck clean across admin.

- [ ] **Unit 2: Scene-recommendations retriever (SQL layer)**

**Goal:** Port cms's `SIMILARITY_SQL` + `RECOMMENDATIONS_SQL` +
`fetchInputEmbeddings` + `getRelatedVideoIds` + `resolveSlugToId`
against admin's per-locale schema, producing structured recommendation
rows that feed the service.

**Requirements:** R5.4, R5.5, R5.6, R5.7 (exclusion via VideoRelation).

**Dependencies:** None (can land before Unit 3).

**Files:**

- Create: `apps/admin/src/services/scene-recommendations-retriever.ts`
- Create: `apps/admin/src/services/scene-recommendations-retriever.test.ts`

**Approach:**

- Four exported functions matching cms's internal decomposition:
  - `resolveSlugToVideoId(prisma, slug)` →
    `SELECT id FROM video WHERE slug = ? AND deleted_at IS NULL LIMIT 1`.
    Returns `string | null`.
  - `fetchInputEmbeddings(prisma, videoId, sceneIndex?)` → raw SQL over
    `video_scene JOIN video_scene_locale` keyed by
    `(video_scene.video_id, [scene_index])`. Returns rows with
    `embedding::text` + `scene_index`. Per-scene mode: filter by
    `scene_index`. Per-video mode: all scenes for the video in the
    requested locale (so the per-scene probes are embedded in the
    requested consumer language). Empty result triggers the service's
    `VideoNotFoundError`.
  - `getRelatedVideoIds(prisma, videoId)` → `WITH exclude AS (SELECT ?
UNION SELECT parent_id FROM video_relation WHERE child_id = ?
UNION SELECT child_id FROM video_relation WHERE parent_id = ?)`.
    Returns `string[]`.
  - `queryScenesSimilar(prisma, queryEmbedding, locale, excludeIds,
limit)` → the big query. `DISTINCT ON (vs.video_id)` over
    `video_scene_locale`, filtered to
    `video.deleted_at IS NULL + video_locale.status='published'
    - dub chain inner join (playback_id guaranteed non-null)`, excludes
`vs.video_id = ANY(excludeIds)`. Outer `SELECT \* FROM (...) sub
      ORDER BY sub.similarity DESC LIMIT ?` pattern same as cms and R4.
  - Wrap in a subquery-then-ORDER-BY-similarity pattern identical to
    R4's semantic retriever so the query planner hits the HNSW index
    then sorts the small candidate set.
- Return a structured `SceneRecommendationRow` type mirroring cms's
  `RecommendationRow` with admin identity types:
  ```ts
  type SceneRecommendationRow = {
    video_id: string // cuid (was int in cms)
    video_slug: string
    video_title: string | null
    video_core_id: string | null
    scene_index: number
    description: string
    start_seconds: number
    end_seconds: number | null
    themes: string[]
    demographics: string[]
    spiritual_context: string[]
    playback_id: string // non-null thanks to INNER JOIN
    similarity: number
    embedding_text: string // service-internal only
  }
  ```
- `video_locale` alias: join on `video_locale.video_id = v.id AND
locale = ? AND status = 'published'` (same as R4).
- Dub/mux join: INNER JOIN ONLY (not LEFT JOIN like R4). The LATERAL
  pattern: the best published dub for the `(edition, locale)` keyed on
  `video_dub.video_edition_id = vs.video_edition_id` + `language.bcp47
= ?` + `mux_video.id = vd.mux_video_id`. Order by `vd.published DESC
NULLS LAST, vd.updated_at DESC LIMIT 1`. If the LATERAL produces
  zero rows the outer row is eliminated.
- **No image URL column.** imageUrl is `null` at the service mapper, not
  queried from SQL.

**Patterns to follow:**

- `apps/admin/src/services/hybrid-search-retrievers.ts::searchVideoSemantic`
  (structural precedent, same schema).
- `apps/cms/src/api/scene-embedding/services/recommender.ts`
  (behavioral precedent — cms's order of filtering / exclusion).

**Test scenarios:**

- `resolveSlugToVideoId` returns the cuid for a known slug; returns
  null for unknown slug; returns null for soft-deleted video.
- `fetchInputEmbeddings` per-scene: returns exactly the row for
  `(video_id, scene_index)` in the requested locale; returns empty if
  locale has no description for that scene.
- `fetchInputEmbeddings` per-video: returns all scenes for the video
  in the requested locale in scene_index order.
- `getRelatedVideoIds` returns `[self, parent, child...]` for videos
  with relations; returns `[self]` alone for a video with no relations.
- `queryScenesSimilar` respects `DISTINCT ON (video_id)` — one row per
  candidate video, ordered by similarity; honors the exclude list;
  returns zero rows when no published dub chain matches the requested
  locale (playback_id null rows filtered out).
- Tests use the seeded test DB pattern R4 established (live Postgres
  for SQL-touching tests).

**Verification:**

- `pnpm --filter @forge/admin test scene-recommendations-retriever`
  passes against a seeded DB with at least: one video with children +
  parent (exclusion coverage), one video with multiple editions
  (primary-edition pick coverage), one locale with no published dub
  (playbackId-filter coverage).
- Raw SQL uses parameterized binds (no string concatenation).

- [ ] **Unit 3: `SceneRecommendationsService` orchestrator**

**Goal:** Shared service with a single `getRecommendations(params)`
entry point. Called by both REST and GraphQL. Implements per-scene vs
per-video mode selection, overfetch, dedup, and final ordering.

**Requirements:** R5.1 (body), R5.2 (body), R5.3, R5.4.

**Dependencies:** Unit 1, Unit 2.

**Files:**

- Create: `apps/admin/src/services/scene-recommendations.service.ts`
- Create: `apps/admin/src/services/scene-recommendations.service.test.ts`

**Approach:**

- Export:
  - `class VideoNotFoundError extends Error` — ported from cms, same
    message semantics (video id + optional scene index).
  - `type SceneRecommendation` — 13 fields matching cms's type;
    `videoId: string` (cuid).
  - `type RecommendationParams = { videoId?: string; slug?: string;
locale: string; sceneIndex?: number; limit?: number }`.
  - `class SceneRecommendationsService { constructor({ prisma }); async
getRecommendations(params): Promise<SceneRecommendation[]> }`.
- Constants: `OVERFETCH_FACTOR = 3`, `MAX_LIMIT = 50`, `DEFAULT_LIMIT =
10`. Extract to top of the file for parity with cms.
- Orchestration flow (mirrors `getRecommendations` in
  `recommender.ts`):
  1. Resolve videoId from slug if needed.
  2. Fetch input embeddings (one row per scene in the requested
     locale). Empty → throw `VideoNotFoundError`.
  3. Compute `excludeIds` via `getRelatedVideoIds`.
  4. One-embedding path (per-scene mode or single-scene video):
     `queryScenesSimilar(..., limit * OVERFETCH_FACTOR)` → dedup →
     slice to `limit`.
  5. Multi-embedding path (per-video mode): loop per-scene,
     `queryScenesSimilar(..., min(limit * 3, 50))`, accumulate
     best-similarity-per-candidate into a `Map<string,
SceneRecommendationRow>`, sort by similarity, dedup → slice to
     `limit`.
- Map `SceneRecommendationRow → SceneRecommendation`:
  - `videoId`: cuid string
  - `videoSlug`: `row.video_slug`
  - `videoTitle`: `row.video_title ?? ""`
  - `imageUrl`: `null`
  - `sceneIndex` / `description` / `startSeconds` / `endSeconds`:
    direct
  - `similarity`: `Number(row.similarity)`
  - `themes` / `demographics` / `spiritualContext`:
    `row.themes ?? []`, etc.
  - `playbackId`: `row.playback_id` (guaranteed non-null by the
    retriever)

**Execution note:** Start with a failing service-level test that
exercises the per-scene path against a small seeded fixture — it
anchors the mode selection before the orchestration code crystallizes.

**Patterns to follow:**

- `apps/admin/src/services/hybrid-search.service.ts` — structural
  entry-point parity.
- `apps/cms/src/api/scene-embedding/services/recommender.ts` —
  behavioral parity.

**Test scenarios:**

- Per-scene mode (sceneIndex provided) returns at most `limit` rows
  sorted by similarity desc after dedup.
- Per-video mode (sceneIndex omitted) merges across scenes, keeping
  best similarity per candidate before dedup.
- Unknown slug throws `VideoNotFoundError` — message includes `-1`
  sentinel for the videoId (matches cms).
- Unknown videoId throws `VideoNotFoundError` with the videoId in the
  message.
- `limit` clamped to `[1, MAX_LIMIT]`.
- Self + parent + child videos are excluded from results (seed a video
  with a child then assert it's absent).
- Embedding-cosine dedup removes one of two near-duplicate scenes
  across different videos (seed two videos with near-identical scene
  embeddings).
- CoreId prefix dedup removes ad-format variants
  (`4_Win4GoodNewsJesus` vs `4_Win4GoodNewsJesusAD1x1`).
- Exact-title dedup removes cross-series duplicates.
- `locale` with no corpus returns `[]` (not an error — data signal).

**Verification:**

- `pnpm --filter @forge/admin test scene-recommendations.service`
  passes.
- typecheck clean.
- No embedding field leaks through the returned object (lint-level
  check — `embedding_text` not re-exposed).

- [ ] **Unit 4: REST handler — `/api/scene-embedding/recommendations`**

**Goal:** Next App Router route handler that validates query params,
rate-limits via `rateLimitAuthRoute`, calls
`SceneRecommendationsService`, and returns cms's exact HTTP envelope.

**Requirements:** R5.1.

**Dependencies:** Unit 3.

**Files:**

- Create: `apps/admin/src/app/api/scene-embedding/recommendations/route.ts`
- Create: `apps/admin/src/app/api/scene-embedding/recommendations/route.test.ts`

**Approach:**

- Export `GET` only.
- Rate limit: `rateLimitAuthRoute({ request, route: "recommendations",
limit: 30, windowMs: 60_000 })`. Return 429 on denial.
- Query params:
  - `videoId` — optional; pass-through cuid string (no `Number`
    coercion; admin identity).
  - `slug` — optional string. At least one of `videoId` or `slug`
    required; otherwise 400 with body `{ error: "videoId or slug is
required" }`.
  - `locale` — required; 400 with body `{ error: "locale is required" }`
    if missing.
  - `sceneIndex` — optional; parse as number; 400 if NaN (matches cms
    controller's validation).
  - `limit` — optional; parse as number; fall through to service
    default on NaN (matches cms's `query.limit ? Number(query.limit) ||
undefined : undefined`).
- Response:
  - 200 with body `{ recommendations: [...] }` on success.
  - 404 with body `{ error: err.message }` on `VideoNotFoundError`.
  - 503 with body `{ error: "Scene recommendation features not
available" }` on any other thrown error. Log via `console.error`
    with the same `[scene-embedding] Recommendations failed: …` prefix
    cms uses so log dashboards stay compatible.

**Patterns to follow:**

- `apps/admin/src/app/api/search/route.ts` — Request/Response envelope
  pattern + rate-limit call shape.
- `apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts`
  `async recommendations` — cms's handler for behavioral parity.

**Test scenarios:**

- Missing `videoId` and `slug` → 400.
- Missing `locale` → 400.
- Non-numeric `sceneIndex` → 400.
- Valid request returns 200 with `{ recommendations: [...] }` envelope.
- `VideoNotFoundError` bubbles to 404 with the error message.
- Rate-limit denial returns 429.
- Unexpected service throw returns 503.

**Verification:**

- `pnpm --filter @forge/admin test
app/api/scene-embedding/recommendations` passes.
- Manual smoke via `pnpm --filter @forge/admin dev` + curl matches the
  same JSON shape as cms's endpoint for a seed query (documented in
  CLAUDE.md).

- [ ] **Unit 5: GraphQL `sceneRecommendations` Pothos query**

**Goal:** Public GraphQL query exposing the service at
`/api/graphql`. Field shape matches cms's SDL field-for-field except
`videoId: ID!` (cuid string).

**Requirements:** R5.2, R5.8.

**Dependencies:** Unit 3.

**Files:**

- Create: `apps/admin/src/graphql/types/scene-recommendation.ts`
  (Pothos type; `@classification public-shape` JSDoc)
- Create: `apps/admin/src/graphql/queries/scene-recommendations.ts`
  (public query resolver)
- Modify: `apps/admin/src/graphql/schema.ts` (side-effect import for
  the new type and query — order-sensitive; reference.ts must still
  load first)
- Create: `apps/admin/src/graphql/queries/scene-recommendations.test.ts`
- Modify: `apps/admin/src/graphql/schema.test.ts` (extend leak-guard
  assertions if the existing regex already covers the new type, which
  it should — no new test cases, but verify the new type is caught by
  the broad scan)

**Approach:**

- Pothos type `SceneRecommendation` with 13 fields:
  - `videoId: ID!`, `videoSlug: String!`, `videoTitle: String!`,
    `imageUrl: String` (nullable), `sceneIndex: Int!`,
    `description: String!`, `startSeconds: Float!`,
    `endSeconds: Float` (nullable), `similarity: Float!`,
    `themes: [String!]!`, `demographics: [String!]!`,
    `spiritualContext: [String!]!`, `playbackId: String!`.
- `@classification public-shape` JSDoc — no ABAC on this type.
- Query field on `Query`:
  - Args: `videoId?: ID`, `slug?: String`, `locale: String!`,
    `sceneIndex?: Int`, `limit?: Int`. At least one of videoId/slug
    required — validate in the resolver like cms does. If neither
    provided, throw `Error("Either videoId or slug must be provided")`
    (byte-parity with cms's message).
  - `authScopes: { public: true }`.
  - Resolve: instantiate `SceneRecommendationsService` from context,
    call `getRecommendations(args)`. Catch `VideoNotFoundError` and
    return `[]` (matches cms's GraphQL resolver). Log any other throw
    via `console.error` and re-throw as
    `Error("Scene recommendation features not available")` to mirror
    cms's public-surface error masking.
- Return type: `[SceneRecommendation!]!`.

**Patterns to follow:**

- `apps/admin/src/graphql/queries/hybrid-search.ts` — `public: true`
  scope and response-type registration for a search-like public query.
- `apps/admin/src/graphql/types/*` — the public-shape classification
  pattern.
- `apps/cms/src/graphql/recommendations.ts` — resolver-level error
  masking (`VideoNotFoundError → []`).

**Test scenarios:**

- Query with `slug + locale` returns a list matching the service.
- Query with `videoId + locale` returns the same list.
- Query with neither `videoId` nor `slug` throws
  `"Either videoId or slug must be provided"`.
- Query with unknown slug returns `[]` (VideoNotFoundError swallowed).
- Query with `sceneIndex` scopes to per-scene mode.
- `limit` > MAX_LIMIT is clamped (behavior comes from the service; test
  at the GraphQL boundary to confirm wiring).
- schema.test.ts's `/embed|vector|similarit/i` scan still passes (the
  `similarity` field is expected and allowed because cms also exposes
  it — update the allowlist if needed).

**Verification:**

- `pnpm --filter @forge/admin test graphql/queries/scene-recommendations`
  passes.
- schema.test.ts passes.
- Introspection shows `sceneRecommendations` on `Query` with the
  advertised args + return type.

- [ ] **Unit 6: Forward-looking `videoRecommendations` Zod variant**

**Goal:** Add a new discriminated-union variant to admin's
`BlockSchema` so future editor work (tatai's feat-100/103) and the
cms-experience-dump transformer (R3) can emit recommendations blocks
without another schema migration.

**Requirements:** R5.7.

**Dependencies:** None.

**Files:**

- Modify: `apps/admin/src/domain/blocks.ts`
- Modify: `apps/admin/src/domain/blocks.test.ts`

**Approach:**

- Declare `VideoRecommendationsBlockSchema` alongside
  `VideoCarouselBlockSchema` (same family). Shape (subject to
  implementation-time rename to align with sibling conventions):
  - `t: z.literal("videoRecommendations")`
  - `sectionKey` (shared primitive)
  - `imageUrl: z.string().url().optional()`
  - `backgroundColor: z.string().optional()`
  - `title: z.string().optional()`
  - `subtitle: z.string().optional()`
  - `description: z.string().optional()`
  - `sourceVideoId: z.string().optional()` (admin cuid; omitted means
    "derive from route video at render time")
  - `sourceSceneIndex: z.number().int().min(0).optional()`
  - `limit: z.number().int().min(1).max(50).default(10)`
  - `.strict()`
- Add to the top-level `BlockSchema` discriminated union ONLY (not to
  `SectionContentBlockSchema` or `ContainerContentBlockSchema` — this
  is a top-level block like `VideoCarousel`).
- Do NOT change any existing union members.
- No Prisma migration.
- No apps/web or admin renderer changes.

**Patterns to follow:**

- `VideoCarouselBlockSchema` (same semantic family: video-driven, items
  derived at render time, top-level placement).
- Block-schema agent-extensibility note in `blocks.ts` header ("adding
  a new block type is (1) add a Zod schema + `t` literal, (2) add it
  to the relevant scope union, (3) add UI handling in the dashboard").
  Step 3 is explicitly out of R5 scope.

**Test scenarios:**

- `BlockSchema.safeParse({ t: "videoRecommendations", limit: 5 })`
  succeeds.
- Unknown key rejected by `.strict()`.
- `limit` outside `[1, 50]` rejected.
- `t: "videoRecommendations"` inside a section's `content` array is
  rejected by `SectionContentBlockSchema` (top-level only).
- The default for `limit` applies when omitted.

**Verification:**

- `pnpm --filter @forge/admin test domain/blocks` passes.
- typecheck clean — discriminated-union exhaustive switches (if any)
  are updated to include the new variant.

## System-Wide Impact

- **Interaction graph:** new REST handler + new Pothos query →
  `SceneRecommendationsService` → retriever → pgvector HNSW index on
  `VideoSceneLocale.embedding`. No writes, no workflow dispatch.
  Rate-limit bucket `"recommendations"` lives in the same Redis
  namespace as `"search"` / `"search-health"` / auth routes — adds
  load but has its own quota per Key.
- **Error propagation:** `VideoNotFoundError` is service-layer; REST
  maps to 404, GraphQL soft-swallows to `[]`. All other throws masked
  as 503 (REST) or `Error("Scene recommendation features not
available")` (GraphQL) to avoid leaking DB/prisma internals.
- **State lifecycle risks:** none — R5 is pure read.
- **API surface parity:** REST + GraphQL both call the same service,
  so a field-name drift in the service is caught once by both
  surfaces' tests. The cms-parity invariant is enforced by
  field-by-field assertions in the GraphQL and REST tests.
- **Integration coverage:** Unit 2's retriever test seeds a live
  Postgres with a small multi-video, multi-edition, multi-locale
  fixture. This covers the cross-layer SQL-to-response-envelope
  invariant that unit tests alone cannot.

## Risks & Dependencies

- **R1 prod backfill not yet complete.** Admin's
  `video_scene_locale.embedding` is sparse in prod until R1 runs. R5
  returns fewer rows than cms for some (video, locale) pairs. Canary
  diff vs cms will reveal the gap; the response shape is still correct,
  and the data fills in as R1 backfills run. Not a code blocker.
- **Doppler / `CMS_DATABASE_URL` for canary diffs.** The canary diff
  step in the ops runbook assumes both endpoints are reachable from the
  same host. Not blocking; informational only.
- **`playbackId` INNER JOIN narrows results vs. cms.** cms relied on
  `se.playback_id` being stored on the scene row directly; admin
  derives it per-`(edition, locale)`. If a video has no dub in the
  requested locale, cms may return it (with its own playbackId for
  that scene) while admin filters it. Canary diff will measure the
  divergence. If the divergence exceeds ±1 ranking position on the
  seed query set, R5 can upgrade to LEFT JOIN + client-side filter at
  R8 time; for now, INNER JOIN preserves the non-null contract.
- **Forward-looking Zod variant has no consumer yet.** No renderer
  exists for `t: "videoRecommendations"`; the R3 content-dump
  transformer does not emit it either. Unused schema is low risk —
  strict validation ensures no silent drift — but worth noting for any
  scope-guardian review.

## Documentation / Operational Notes

- Append a new "Scene recommendations (R5 of admin migration
  playbook)" section to `apps/admin/CLAUDE.md` with the same structure
  R4 uses: what admin owns, schema anchors, service file, REST +
  GraphQL endpoints, rate-limit bucket, operational runbook (canary
  diff against cms's endpoint for a fixed (slug, locale) × (seed
  queries) grid, HNSW-usage verification via `EXPLAIN ANALYZE`), and a
  "Common things to remember" list (INNER JOIN on playback, cms-parity
  imageUrl null, forward-looking Zod variant has no authoring UX yet,
  R1 backfill dependency for prod data readiness).
- Add a durable learnings doc at
  `docs/solutions/platform/admin-scene-recommendations-r5-pattern.md`
  capturing the shared-dedup-primitive extraction, the INNER-JOIN vs
  R4's LEFT-JOIN decision, and the identity-type delta at the GraphQL
  surface. Referenced from CLAUDE.md.
- Update the R4 section of CLAUDE.md with a one-line note that
  `deduplicateResults` is now a thin wrapper over
  `video-dedup.dedupeByVideoIdentity`, so future readers don't go
  hunting for the logic in the wrong file.
- Roadmap: add a `feat-NNN` entry for R5 (or repurpose the existing
  playbook line) with `status: in-progress` at commit time,
  `status: complete` at merge.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md](/workspace/docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md) (requirement R5, Cross-Cutting Constraints)
- **R4 sibling plan:** docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md
- **cms source (port from):**
  - apps/cms/src/api/scene-embedding/services/recommender.ts
  - apps/cms/src/api/scene-embedding/controllers/scene-embedding.ts
  - apps/cms/src/api/scene-embedding/routes/scene-embedding.ts
  - apps/cms/src/graphql/recommendations.ts
- **apps/web consumer contract:**
  - apps/web/src/lib/recommendations.ts (raw gql query; SceneRecommendation type)
  - apps/web/src/components/sections/VideoRecommendations.tsx
- **admin patterns to mirror:**
  - apps/admin/src/services/hybrid-search.service.ts
  - apps/admin/src/services/hybrid-search-retrievers.ts
  - apps/admin/src/services/hybrid-search-fusion.ts
  - apps/admin/src/app/api/search/route.ts
  - apps/admin/src/graphql/queries/hybrid-search.ts
  - apps/admin/src/domain/blocks.ts
- **admin data model:** apps/admin/prisma/schema.prisma (Video,
  VideoLocale, VideoScene, VideoSceneLocale, VideoRelation, VideoDub,
  MuxVideo, Language)
- **Learnings:**
  - docs/solutions/platform/admin-hybrid-search-r4-pattern.md
  - docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md
  - docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md
