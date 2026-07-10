---
title: Admin hybrid search (R4) — port pattern
category: platform
date: 2026-04-23
tags: [admin, search, pgvector, tsvector, rrf, migration]
---

# Admin hybrid search (R4) — port pattern

## Context

R4 of the admin-migration playbook. Ports cms's `/api/search` +
`/api/search/health` from `apps/cms/src/api/search/` to
`apps/admin/src/services/hybrid-search*.ts` + `src/app/api/search/**`
so apps/web + apps/mobile can swap search backends at R8 cutover with
zero response-shape drift. Source-of-truth is cms's implementation
(feat-010 + feat-086 + feat-097 contract); admin's implementation is
shape-equivalent on top of admin's per-locale Prisma schema.

## The port invariants

1. **4-list RRF.** Exactly four ranked lists feed Reciprocal Rank
   Fusion: `semantic-video`, `keyword-video`, `semantic-experience`,
   `keyword-experience`. RRF k = 60, normalization by `lists.length /
(k + 1)`, descending score sort. Empty lists are filtered out
   before fusion (RRF normalizes by list count — feeding empty ones
   dilutes scores from lists that did contribute). Transcript evidence
   belongs inside `semantic-video`, not as a fifth list.
2. **3-layer video-only dedup.** coreId prefix match, exact title,
   embedding cosine > 0.95. Experience rows bypass all three checks.
   Cosine dedup needs per-row `embeddingText`, which is why the
   semantic-video SQL returns `embedding::text` — a service-internal
   transport that never reaches GraphQL.
3. **`searchMode` degradation.** `"hybrid"` when the embedding call
   succeeds; `"keyword-only"` when it throws. The response is always
   HTTP 200 on orchestration success; 503 is reserved for total
   orchestrator failure. Structured error log:
   `[search] event=query_embedding_failure error_class=… message=…`.
4. **`/api/search/health` always returns 200.** Body's `status` is the
   machine-readable signal. Matches cms parity so external monitors
   (Railway healthcheck, uptime tools, curl checks) swap URLs without
   changing their success rule.
5. **PUBLIC at both REST and GraphQL.** ABAC enforced in SQL (WHERE
   `status = 'published'` + `archived_at IS NULL` on the right
   tables). No EDITOR/ADMIN widening in R4 — the existing
   `searchExperiences` GraphQL field remains the admin-dashboard
   elevated-role path.

## Data-model divergences that bit (and got re-derived)

- **Title/description location.** cms: `videos.title`. Admin:
  `VideoLocale.title` (per-locale). Keyword-video SQL joins
  `video_locale` and filters `locale + status = 'published'`.
- **Consumer visibility gate.** cms: `videos.published_at IS NOT NULL`
  - variant link chain. Admin: `VideoLocale.status = 'published'` +
    `Video.deleted_at IS NULL`. `VideoDub.published` is a separate
    boolean — NOT the consumer-visibility gate.
- **Scene embedding shape.** cms: `scene_embeddings` single-row-per-
  scene with language-agnostic embedding. Admin: per-locale on
  `VideoSceneLocale` (R1 schema). Semantic-video SQL filters
  `vsl.locale = ?` and uses per-locale partial HNSW indexes.
- **PlaybackId path.** cms: `scene_embeddings.playback_id` denormalized.
  Admin: 3-hop via `VideoScene → VideoDub(edition_id, language_id)
→ MuxVideo.playback_id`. A LATERAL subquery preferring the published
  dub for the requested locale resolves it; null when no dub matches.
- **bcp47 column name.** Admin's `Language.bcp47` has NO underscore.
  cms used `languages.bcp_47`.
- **Id typing.** cms returned integer ids; admin returns cuid strings.
  Consumer contracts tolerate both during the R3→R8 window because
  R3's experience-content-dump already migrated experiences to cuid
  ids before admin exposed them anywhere consumer-facing.
- **Experience identity in results.** cms used the parent experience
  id. Admin uses `ExperienceLocale.id` — the per-locale row is the
  natural identity since slugs, content, and embeddings all live
  there.

## GIN index byte-parity invariant

`src/services/hybrid-search-sql.ts` exports two forms of each tsvector
expression: an INDEX form (bare columns, used verbatim by the
migration) and a QUERY form (aliased columns, interpolated into
retriever SQL via `Prisma.raw`). A unit test in
`hybrid-search-sql.test.ts` reads
`prisma/migrations/0006_hybrid_search_gin/migration.sql` from disk and
asserts the INDEX-form substring appears verbatim. Any drift —
typically a reviewer cleaning up whitespace in one but not the other —
silently reverts the query to Seq Scan.

## What stays unused in R4

- **`ExperienceLocale.ogImageUrl`.** Populated by R3, but the R4
  response maps `imageUrl: null` for experience results per cms
  parity. Upgrade lands after R8.

## Post-feat-192 video semantic upgrade

`semantic-video` is still the video semantic RRF list, but its runtime evidence
is now enriched transcript chunks. `searchVideoSemantic` reads
`video_transcript_chunk.embedding` rows that match the accepted gateway
provider/model/dimension provenance, collapses to the best transcript chunk per
video, and returns one ranked semantic video candidate per video to RRF. The
winning chunk owns the public-facing snippet/timecode and the service-internal
`embeddingText` used by video dedup.

This keeps the four-list RRF invariant intact. Do **not** add
`semantic-transcript-video` as a separate RRF input unless the product decision
changes explicitly; doing so double-counts semantic video evidence and changes
debug/dilution semantics. Also do not re-enable scene embedding retrieval as a
fallback; transcript relevance gaps should be fixed in the enriched transcript
signal, ranking layer, or eval gates.

## What R4 establishes as admin-first patterns

- **First non-GraphQL REST endpoints in admin** outside of `/api/auth`
  and `/api/graphql`. Query-string parsing via
  `new URL(request.url).searchParams`; rate limiting via
  `rateLimitAuthRoute` with per-route keys; 400/429/503 error bodies
  shaped like cms's responses. R5 (`/api/scene-embeddings/recommendations`)
  and R7 (revalidation webhook) inherit this pattern.
- **Public Pothos query that wraps a service.** The `search` field
  routes through `HybridSearchService` rather than a direct Prisma
  call. The same service is shared with the REST handler so both
  front doors share SQL semantics, degradation behavior, and
  structured logs.
- **Service-internal raw-SQL transport of `embedding::text`.** The
  schema.test.ts `/embed|vector|similarit/i` guard is a GraphQL-surface
  check; raw SQL inside services is out of scope. R4 is the reference
  example — future services that need similarity transport for
  intra-list dedup can follow the same pattern.

## Why `generateExperienceEmbedding` got reused verbatim (and why its name is wrong)

Admin's existing query embedder is `generateExperienceEmbedding(text:
string)`. The name dates from R3 when experience text was the only
input. By R4 it's genuinely generic — any string in, 1536-dim vector
out, OpenRouter → OpenAI fallback, 30s timeout, Zod-validated
response. R4 reuses it verbatim rather than pulling a rename into
scope. Renaming to `embedText` or similar is a follow-up clean-up with
churn across R3's call sites; keeping R4 tightly scoped is the
tradeoff.

## Post-cutover follow-ups flagged by R4

- Wire `ExperienceLocale.ogImageUrl` through `imageUrl` for experience
  results (once cms/admin diff invariant is no longer needed).
- Rename `generateExperienceEmbedding` to `embedText`.
- Add EDITOR/ADMIN widening to the `search` field if the admin
  dashboard grows a search UX that needs to see drafts.

## Related

- Plan: `docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md`
- Requirements: `docs/brainstorms/2026-04-23-admin-hybrid-search-r4-requirements.md`
- Playbook: `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
- Source pattern: `apps/cms/src/api/search/**`
- Sibling R-pattern docs:
  - `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  - `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`
  - `docs/solutions/platform/admin-experience-content-dump-pattern.md`
