---
title: "Keep semantic recommendation retrieval within the immutable 1.5-second budget"
date: "2026-08-20"
last_updated: "2026-09-09"
category: "performance-issues"
module: "apps/admin semantic recommendation delivery"
problem_type: "performance_issue"
component: "database"
symptoms:
  - "Recommendation retrieval exhausted the immutable 1,500 ms delivery deadline."
  - "Parent provenance joins displaced HNSW access with a bitmap scan and distance sort."
  - "Long-seed family exclusions expanded to transcripts across all languages."
  - "Prepared executions switched to a generic non-ANN plan."
  - "Nearer incompatible chunks exhausted default HNSW scanning before filling the slate."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "service_object"
  - "testing_framework"
tags:
  - "semantic-recommendations"
  - "pgvector"
  - "hnsw"
  - "latency-budget"
  - "embedding-provenance"
  - "prepared-statements"
  - "iterative-scan"
  - "production-snapshot"
---

# Keep semantic recommendation retrieval within the immutable 1.5-second budget

## Problem

Recommendation delivery must retrieve and issue useful cards within an immutable 1,500 ms budget. Bounded output alone does not bound database work: query joins, exclusion sets, prepared plans, and approximate-index filtering can still produce timeouts or empty slates.

The original August repair replaced a per-chunk retrieval loop with a set-based query. Eight evenly distributed seed probes and 48 neighbors per probe brought restored-snapshot delivery inside the budget. The September `feat-470` investigation reproduced a further regression after exact active embedding-contract checks were added. The indexes still existed, but the planner no longer consistently used them.

## Symptoms

- Original production Birth of Jesus / English SQL used a bitmap scan and distance sort and was canceled by the 2,500 ms diagnostic timeout.
- Moving parent provenance into a scalar lookup restored HNSW, taking 169.907 ms initially and 61.625 ms on a repeat. Long JESUS / English still exceeded 2,500 ms.
- The long-seed plan expanded related videos into transcripts across every language and repeatedly scanned that materialized exclusion set.
- A persistent prepared scalar query used custom HNSW plans for five mixed inputs, then selected a generic plan without HNSW on its sixth execution.
- Default HNSW scanning returned no eligible targets in an indexed fixture dominated by nearer incompatible chunks.

The reproduced SQL defects justify this repair without establishing an exact historical deployment cause. Viewer-usage analytics are outside this public technical learning.

## What Didn't Work

Raising the timeout would hide the problem and weaken the delivery contract. A single SQL statement or a fixed neighbor limit also does not prove bounded execution.

Restoring HNSW access alone left the all-language family-exclusion bottleneck intact. Moving provenance checks after a fixed 48-neighbor cap instead allowed nearer incompatible embeddings to crowd valid targets out of the candidate window.

Iterative scanning does not change the planner's choice of access path. It helps only after HNSW is selected. Conversely, a good first custom plan does not prove that prepared-query reuse will retain it.

A tiny deterministic fixture without an index could validate SQL eligibility while completely missing the planner regression. Identical/orthogonal synthetic vectors also produced misleading disconnected-graph behavior; the indexed regression uses varied directions.

## Solution

The current implementation remains in `apps/admin/src/services/recommendations/delivery-retriever.ts`:

1. Select seed chunks with exact active parent/chunk embedding provenance using `activeTranscriptContentEmbeddingWhere` from `apps/admin/src/services/content-embedding-contract.ts`.
2. Sample at most eight seed chunks evenly with `ntile`.
3. Materialize only the seed and direct parent/child **video IDs**.
4. For each probe, scan candidate chunks ordered by cosine distance. Use a correlated scalar parent lookup by primary key for exact provenance and video-family exclusion. Keep these checks before `LIMIT 48`.
5. Apply the existing publication, platform, exact audio-language, and playable-dub checks; retain the best chunk per video and overfetch six times the requested slate size for composition and identity deduplication.

The parent lookup deliberately remains a scalar boolean subquery rather than a top-level join:

```sql
AND (
  SELECT true
  FROM video_transcript candidate_transcript
  WHERE candidate_transcript.id = candidate.transcript_id
    -- The shared helper adds exact active parent AND chunk provenance here.
    AND EXISTS (/* activeTranscriptContentEmbeddingWhere predicate */)
    AND NOT EXISTS (
      SELECT 1
      FROM excluded_video_ids excluded
      WHERE excluded.id = candidate_transcript.video_id
    )
)
ORDER BY candidate.embedding OPERATOR(public.<=>) seed.seed_embedding
LIMIT 48
```

This is a query-shape sketch; use the canonical helper in executable code. Its parent primary key permits at most one row, and a missing/incompatible result fails the filter. Production's required parent foreign key also prevents orphan chunks.

`runRecommendationRetrievalQuery` in `apps/admin/src/services/recommendations/delivery-runtime.ts` applies these settings only within the existing retrieval transaction:

```sql
SELECT
  set_config('plan_cache_mode', 'force_custom_plan', true),
  set_config('hnsw.iterative_scan', 'strict_order', true),
  set_config('hnsw.max_scan_tuples', '20000', true);
```

The existing absolute deadline still determines Prisma pool wait, transaction timeout, and PostgreSQL statement timeout. No global planner/index forcing, longer timeout, larger `ef_search`, or scan-memory increase is needed.

## Why This Works

The scalar lookup preserves ordered HNSW access while rejecting incompatible provenance before the returned-neighbor cap. Comparing the resolved parent's video ID against the small exclusion set avoids scanning every translated transcript in the family.

Custom planning preserves parameter-aware locale-index choices after prepared-query reuse. Strict iterative scanning continues through rejected nearer vectors until enough compatible neighbors are found or scan/time limits are reached. Approximate retrieval still trades recall for speed; the 20,000-tuple cap is approximate, not a guarantee of exhaustive eligibility.

In production SQL diagnostics, final short/long English, Spanish, French, and Portuguese samples took **25.819–198.552 ms**. Birth / English grew from 118 to 192 neighbors and 14 to 20 ordered targets when strict scanning was enabled. JESUS / English fell from a timeout to 65.347 ms with all 384 neighbor slots filled. English/Spanish/French used locale HNSW indexes; Portuguese retained bitmap scanning and sorting.

On the restored, analyzed snapshot with **280,107 embedded chunks**, local complete-service checks took **308/185 ms** for cold/warm semantic candidate pools and **279/252 ms** for hybrid personalized delivery, returning six cards in each case. These samples include retrieval, composition, signing, persistence, and serialization with fixture admission/serving authority. They are not live HTTP percentiles, concurrency tests, or cold database-cache measurements.

See the [verification report](../../reports/2026-09-09-recommendation-retrieval-verification.md) for methods, evidence, and limits. Neither SQL samples nor local service checks establish post-deployment recovery or greater recommendation helpfulness.

## Prevention

- Keep the single `DELIVERY_RETRIEVAL_BUDGET_MS` contract in `apps/admin/src/services/recommendations/contracts.ts`; do not duplicate or widen it.
- Run `delivery-retriever.db.test.ts` in both explicit modes: `RECOMMENDATION_DELIVERY_DB_FIXTURE=deterministic` for CI and `=production_snapshot` for representative catalog verification, with `RECOMMENDATION_DB_TEST=1` and a disposable local database.
- Protect eligibility and fill together. More than 48 nearer incompatible parent/chunk embeddings must not crowd out valid targets. Require actual HNSW access in the indexed fixture, an eligible six-card slate, family exclusions, exact transform matching, and connection-setting cleanup after commit and rollback.
- Recheck prepared-query reuse, long hierarchies, real audio-language slugs, and contract-skewed vectors when changing filters. Use production-shaped `EXPLAIN (ANALYZE, BUFFERS)`; planner estimates alone are not timings.
- Changing probes, neighbor caps, or downstream eligibility needs separate relevance/diversity and fill evidence. Publication/playability remain downstream of the ANN cap, so dense ineligible content can still reduce slate fill.
- Measure service and browser boundaries after SQL checks. A warm candidate pool can mask a broken live query; distinguish `served`, `fallback`, empty results, and `retrieval_timeout`.
- After normal PR-to-main deployment, compare timeout and served/fill rates by seed, locale/audio, strategy, and traffic mix. Monitor Portuguese and larger profile-interest workloads: their measured bitmap/sort samples do not establish scalability.

## Related Issues

- [feat-470 repair plan](../../plans/2026-09-09-fix-recommendation-retrieval-plan.md) and [verification evidence](../../reports/2026-09-09-recommendation-retrieval-verification.md).
- [Restoring the Admin video/search snapshot locally](../developer-experience/admin-prod-video-snapshot-local-restore-20260521.md).
- [pgvector HNSW index bypass with filters](pgvector-hnsw-index-bypass-with-where-filter-20260415.md). Its earlier joined-table example is not a general guarantee: a parent provenance join can displace HNSW even with a locale partial index.
- [Result-preserving Admin search optimization](admin-search-result-preserving-latency-optimization.md) and [the semantic HNSW prototype parity gate](admin-semantic-hnsw-prototype-parity-gate.md).
- [pgvector filtering and iterative scans](https://github.com/pgvector/pgvector#iterative-index-scans).
