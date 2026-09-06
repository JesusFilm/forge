---
title: "Keep semantic recommendation retrieval within the immutable 1.5-second budget"
date: "2026-08-20"
last_updated: "2026-08-24"
category: "performance-issues"
module: "apps/admin semantic recommendation delivery"
problem_type: "performance_issue"
component: "database"
symptoms:
  - "A production-snapshot Watch request exhausted the semantic recommendation transaction deadline and degraded the recommendation block."
  - "The initial production-shaped browser run completed in 1528 milliseconds, crossing the immutable 1.5-second Admin retrieval budget."
  - "A wider seed and neighbor fan-out performed more pgvector work than a six-item recommendation slate required under ordinary application load."
root_cause: "query_shape"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "service_object"
  - "testing_framework"
  - "frontend_stimulus"
tags:
  - "semantic-recommendations"
  - "pgvector"
  - "watch"
  - "latency-budget"
  - "set-based-sql"
  - "seed-sampling"
  - "production-snapshot"
  - "browser-qa"
---

# Keep semantic recommendation retrieval within the immutable 1.5-second budget

## Problem

Production-snapshot browser QA on the unmerged feat-368 branch exposed a performance regression in semantic recommendation delivery: retrieval completed in 1,528 ms, just beyond the required 1.5-second boundary. The delivery contract remains exactly `1_500` ms (`apps/admin/src/services/recommendations/contracts.ts:12-19`), and delivery converts that duration into one absolute retrieval deadline before invoking the retriever (`apps/admin/src/services/recommendations/delivery.service.ts:238-254`).

The risk was user-visible even though Watch remained resilient. A deadline breach throws the typed retrieval timeout (`apps/admin/src/services/recommendations/delivery.service.ts:133-160`); when there is no still-valid candidate pool, delivery returns an unavailable result with `retrieval_timeout` instead of a semantic slate (`apps/admin/src/services/recommendations/delivery.service.ts:259-290`). The optimization therefore had to fit the production semantic path inside the contract while preserving the versioned response, exact audio-language playback eligibility, deterministic presentation hydration, persisted request trace, and compatibility service.

## Symptoms

- Restored-production-snapshot browser QA observed a 1,528 ms recommendation retrieval, 28 ms over the contract, and the request degraded instead of rendering a semantic slate.
- The compatibility retriever's multi-chunk mode fetches all seed embeddings and then performs a similarity query sequentially for every embedding (`apps/admin/src/services/scene-recommendations.service.ts:127-138`, `apps/admin/src/services/scene-recommendations.service.ts:155-173`). Its round-trip count grows with seed transcript length.
- The failure only became representative after testing against a restored database containing real transcript vectors. The real-database test now targets the `jesus` seed and imports the shared contract constant (`apps/admin/src/services/recommendations/delivery-retriever.db.test.ts:1-9`, `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts:166-198`).

## What Didn't Work

Raising the timeout would have hidden the regression and weakened a user-facing guarantee. The constant is intentionally unchanged at 1.5 seconds (`apps/admin/src/services/recommendations/contracts.ts:12-19`), and both the service deadline and the database timeout still derive from it (`apps/admin/src/services/recommendations/delivery.service.ts:238-254`, `apps/admin/src/services/recommendations/delivery.service.ts:163-190`).

Reusing the compatibility service's multi-chunk orchestration was also unsuitable for this deadline. Although it preserves existing recommendation semantics, it issues one candidate query per seed embedding inside a sequential loop (`apps/admin/src/services/scene-recommendations.service.ts:155-173`). A long-form seed therefore turns content coverage into database round-trip fan-out.

An earlier set-based tuning in the same unmerged session sampled 12 seed probes with 64 neighbors each. It removed the per-chunk round trips but still produced the 1,528 ms browser result under application load, showing that one SQL statement alone did not provide enough cold-path margin. The current source uses eight probes and 48 neighbors (`apps/admin/src/services/recommendations/delivery-retriever.ts:10-19`).

An earlier semantic prototype already used database-side pgvector filtering and best-chunk-per-video selection, but had no hard deadline or production-shaped benchmark; its CMS recommendation block was also only scaffolding (session history). A set-oriented backend result was therefore not evidence that the production budget or the real Watch-to-Admin flow was safe.

## Solution

The delivery path now has a dedicated bounded, set-based retriever while the compatibility service stays intact. Production delivery wires this retriever through the existing deadline-scoped transaction (`apps/admin/src/services/recommendations/delivery.service.ts:497-523`), and the retriever performs the complete candidate search in one raw-query call (`apps/admin/src/services/recommendations/delivery-retriever.ts:49-62`, `apps/admin/src/services/recommendations/delivery-retriever.ts:205-264`).

The query bounds work in stages:

1. Select only compatible, locale-matched 1,536-dimension Qwen transcript embeddings for the seed (`apps/admin/src/services/recommendations/delivery-retriever.ts:63-81`).
2. Divide the ordered transcript into at most eight buckets and choose one deterministic seed embedding from each bucket, retaining coverage across the transcript without probing every chunk (`apps/admin/src/services/recommendations/delivery-retriever.ts:82-97`).
3. Run a bounded cosine-neighbor probe capped at 48 returned rows for each sampled seed, excluding the seed video and directly related videos before hydration (`apps/admin/src/services/recommendations/delivery-retriever.ts:98-140`). This caps the application-visible neighbor window at 384 rows; it does not claim that the database examines only 384 vectors.
4. Keep mutable delivery eligibility in the same statement: targets must be undeleted, Watch-eligible, published in the requested transcript locale, and have a playable dub whose language slug exactly matches `audioLanguageSlug` (`apps/admin/src/services/recommendations/delivery-retriever.ts:142-194`). Locale and playable audio language remain separate cache-key and recheck inputs (`apps/admin/src/services/recommendations/delivery.service.ts:234-281`).
5. Retain the best transcript chunk per target video, order deterministically, cap the post-eligibility pool at three times the requested slate size, select a stable preferred thumbnail, and pass rows through the shared identity deduplicator's core-ID prefix, exact-title, and embedding-similarity layers (`apps/admin/src/services/recommendations/delivery-retriever.ts:19-19`, `apps/admin/src/services/recommendations/delivery-retriever.ts:196-256`, `apps/admin/src/services/recommendations/delivery-retriever.ts:270-307`, `apps/admin/src/services/video-dedup.ts:61-91`). For a six-item request, no more than 18 target videos reach final image hydration and application deduplication.

The unit test locks in the compatibility properties: the retriever invokes `$queryRaw` once and maps its result to the unchanged `SceneRecommendation` DTO (`apps/admin/src/services/recommendations/delivery-retriever.test.ts:24-53`). The real-database test requires a non-empty, unique, seed-excluding, image-hydrated slate to complete strictly below the shared 1.5-second contract (`apps/admin/src/services/recommendations/delivery-retriever.db.test.ts:166-198`). CI provisions PostgreSQL 18 with pgvector and runs the test against a deterministic fixture as a repeatable SQL and contract gate; the approved restored snapshot remains the production-shaped latency gate (`.github/workflows/ci.yml:97-150`).

Delivery then prepares the complete returned slate, persists the request root and all presentation/provenance item records in one transaction, signs the item capabilities, and only then transitions the root to `ISSUED` (`apps/admin/src/services/recommendations/delivery.service.ts:299-461`). That makes the slate received by Watch the same ordered unit traced in Admin.

In verification on 2026-08-24 for draft PR #1976, one approved-snapshot retrieval-transaction sample completed in 547 ms and one end-to-end browser delivery-request sample completed in about 668 ms. The browser rendered six cards with six loaded thumbnails and accepted six render-evidence posts; the authorized Admin request detail showed the corresponding six ordered items and access audit. These are samples from the unmerged branch, not merged guarantees. They measure different boundaries: Admin retrieval is capped at 1.5 seconds, the Web-to-Admin delivery request has a 1.9-second upstream timeout, and Watch owns the enclosing 2-second lazy boundary (`apps/admin/src/services/recommendations/contracts.ts:17-18`, `apps/web/src/lib/recommendations.ts:15-20`).

## Why This Works

The expensive application-visible neighbor fan-out is bounded independently of transcript length. At most eight sampled seed embeddings enter the lateral stage, and each can return at most 48 neighbors (`apps/admin/src/services/recommendations/delivery-retriever.ts:82-97`, `apps/admin/src/services/recommendations/delivery-retriever.ts:110-140`). That caps the returned pre-eligibility window at 384 rows instead of allowing one query for every seed transcript chunk. Selecting and partitioning seed chunks, building exclusions, and database index traversal remain data-dependent.

Sampling with `ntile` preserves position coverage instead of simply taking the first eight chunks (`apps/admin/src/services/recommendations/delivery-retriever.ts:82-97`). This reduces cost without making the recommendation signal depend only on the opening of a long-form transcript.

Set-based filtering also removes application/database chatter. Exclusion, playback eligibility, locale publication state, best-chunk ranking, stable presentation hydration, and result limiting all execute in the same statement (`apps/admin/src/services/recommendations/delivery-retriever.ts:98-264`), while the single-query unit assertion protects that round-trip shape (`apps/admin/src/services/recommendations/delivery-retriever.test.ts:24-53`).

The optimization does not weaken failure containment. The raw SQL still runs in an interactive transaction whose Prisma wait, transaction timeout, and PostgreSQL statement timeout share the service's absolute deadline (`apps/admin/src/services/recommendations/delivery.service.ts:163-190`), and delivery still maps genuine timeout failures to its established degraded response (`apps/admin/src/services/recommendations/delivery.service.ts:259-290`). Rows still map to the existing recommendation fields and pass through the established identity deduplicator (`apps/admin/src/services/recommendations/delivery-retriever.ts:270-307`).

## Prevention

- Keep the retrieval contract singular and executable. Production code and the database gate must import `DELIVERY_RETRIEVAL_BUDGET_MS` instead of duplicating or widening it (`apps/admin/src/services/recommendations/contracts.ts:12-19`, `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts:1-7`, `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts:166-198`).
- Preserve the dual-mode database gate: use the deterministic PostgreSQL 18/pgvector fixture in CI for repeatable SQL and contract coverage, and the approved restored snapshot for production-shaped cardinality, vector distribution, and latency evidence (`apps/admin/src/services/recommendations/delivery-retriever.db.test.ts:17-164`, `.github/workflows/ci.yml:97-150`).
- Protect latency and semantics together: require results, enforce the six-item ceiling, check unique video identities, exclude the seed, require hydrated image URLs, verify exact audio-language slug propagation, and assert elapsed time below the contract (`apps/admin/src/services/recommendations/delivery-retriever.db.test.ts:166-198`, `apps/admin/src/services/recommendations/delivery-retriever.test.ts:94-106`).
- Keep the one-round-trip unit regression test so a refactor cannot silently reintroduce per-chunk application fan-out (`apps/admin/src/services/recommendations/delivery-retriever.test.ts:24-53`).
- Treat the probe and neighbor limits as performance-and-recall controls. Any increase to the current eight-by-48 fan-out (`apps/admin/src/services/recommendations/delivery-retriever.ts:10-19`) needs restored-snapshot cold and warm measurements, slate quality checks, and browser-level Watch timing while the 1.5-second boundary remains unchanged.
- For each newly served locale and after PostgreSQL or pgvector upgrades, capture a production-shaped `EXPLAIN (ANALYZE, BUFFERS)` and verify the expected locale-aware HNSW plan before treating the latency sample as representative. The neighbor `LIMIT` bounds returned rows, not planner work.
- Measure quality as well as speed over a representative seed, transcript-locale, and audio-language matrix. Track full-slate fill rate, semantic relevance/diversity, and exact playable-dub eligibility before changing the eight probes, 48 neighbors, or three-times target overfetch.
- Keep deterministic tie-breakers on every one-row hydration lookup, including dub identity and image identity (`apps/admin/src/services/recommendations/delivery-retriever.ts:181-194`, `apps/admin/src/services/recommendations/delivery-retriever.ts:230-256`).
- Continue browser QA after database-only benchmarks. Start with a cold candidate-pool key or fresh process, require `result: "served"`, capture the request ID, and reconcile Watch rendering and lifecycle evidence with its Admin trace. Validate `fallback` separately; a warm 60-second candidate pool can render healthy cards while masking a live-query regression (`apps/admin/src/services/recommendations/delivery.service.ts:234-296`).
- Interpret Admin latency percentiles alongside result counts. Post-admission retrieval timeout/unavailable branches persist reason-coded request roots when the manifest and database are available, while invalid input, admission denial, serving-state failure, and persistence failure still return unattributed unavailable responses. Monitor those response-only reasons at the GraphQL or Watch boundary alongside Admin p50/p95 (`apps/admin/src/services/recommendations/delivery.service.ts:202-230`, `apps/admin/src/services/recommendations/delivery.service.ts:259-350`).

## Related Issues

- [Restoring a production-like Admin video/search database locally](../developer-experience/admin-prod-video-snapshot-local-restore-20260521.md) is the canonical vector-bearing snapshot procedure used by the regression.
- [Result-preserving Admin search latency optimization](admin-search-result-preserving-latency-optimization.md) documents the broader rule that semantic performance work must preserve response semantics rather than lengthen timeouts.
- [Bounding the visible semantic candidate window](admin-semantic-db-retrieval-visible-candidate-window.md) provides the related set-based SQL staging pattern.
- [Admin search pool and keyword-first fan-out](admin-search-pool-and-keyword-first-fanout.md) shows how query fan-out and connection scheduling can dominate end-to-end latency.
- [The semantic HNSW prototype parity gate](admin-semantic-hnsw-prototype-parity-gate.md) is the quality and diversity caution for future probe/window retuning.
- [pgvector HNSW index bypass with filters](pgvector-hnsw-index-bypass-with-where-filter-20260415.md) is the next diagnostic if stable bounded fan-out later regresses.
- [The legacy Strapi pgvector recommendation pattern](../best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md) remains useful history for locale, hierarchy, and best-per-video rules, but its per-scene runtime loop is not the current delivery authority.
