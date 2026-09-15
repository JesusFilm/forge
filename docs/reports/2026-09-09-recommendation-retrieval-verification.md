# Recommendation retrieval repair verification — September 9, 2026

`feat-470` repairs a reproduced query problem behind recommendation delivery timeouts. It preserves the exact active embedding contract, source-family exclusions, eight seed probes, 48 compatible neighbors per probe, and the existing 1,500 ms delivery budget.

## Production SQL evidence

Diagnostics used PostgreSQL 18.6 / pgvector 0.8.2, sequential `BEGIN READ ONLY` transactions, a 2,500 ms statement timeout, a 1,000 ms lock timeout, and rollback after each probe. No production data, schema, indexes, configuration, or deployment changed. The query was captured from the actual Prisma retriever; embedding vectors and viewer identifiers are absent from this report and its [aggregate evidence](2026-09-09-recommendation-retrieval-verification/production-sql-summary.json).

The original Birth of Jesus / English query chose a bitmap scan and distance sort and was canceled at 2,500 ms. Moving provenance into a scalar parent lookup restored the English HNSW index, taking 169.907 ms initially and 61.625 ms on a repeat. That alone was insufficient: the long JESUS seed still exceeded 2,500 ms because its family exclusion materialized transcripts across all languages and repeatedly scanned that set.

Checking the parent video's identity inside the scalar lookup removes that expansion. JESUS / English then took 42.600 ms with iterative scanning off, or 65.347 ms with strict iterative scanning and a fuller candidate window.

The final query used transaction-local `force_custom_plan`, `hnsw.iterative_scan=strict_order`, and `hnsw.max_scan_tuples=20000`:

| Seed           | Locale / exact audio slug   | Seed chunks / probes | SQL execution | Neighbors | Ordered targets |
| -------------- | --------------------------- | -------------------: | ------------: | --------: | --------------: |
| Birth of Jesus | en / english                |                4 / 4 |     25.819 ms |       192 |              20 |
| JESUS          | en / english                |              176 / 8 |     65.347 ms |       384 |              36 |
| Birth of Jesus | es / spanish-latin-american |                2 / 2 |    106.403 ms |        96 |              25 |
| JESUS          | es / spanish-latin-american |              123 / 8 |     61.410 ms |       384 |              36 |
| Birth of Jesus | fr / french                 |                3 / 3 |     26.347 ms |       144 |              36 |
| JESUS          | fr / french                 |              126 / 8 |     50.468 ms |       384 |              36 |
| Birth of Jesus | pt / portuguese-brazil      |                2 / 2 |     59.236 ms |        96 |              31 |
| JESUS          | pt / portuguese-brazil      |              161 / 8 |    198.552 ms |       384 |              36 |

English, Spanish, and French used their locale HNSW indexes. Portuguese retained a bitmap scan and sort, which completed within these samples. A faster sample does not establish scalability for that access path.

These are complete SQL execution times on the database server. They exclude network round trips and service composition, are sequential samples with caches left intact, and establish neither production request percentiles nor performance under concurrency. Ordered targets precede application identity deduplication and final slate selection.

## Why the transaction settings are necessary

The persistent prepared intermediate query used custom HNSW plans for five mixed seed/locale calls, then switched to a generic plan without HNSW on calls six and seven. Birth / English took 219.134 ms under that generic plan versus 53.008 ms on its first custom sample. The repair preserves parameter-aware planning inside retrieval transactions; it does not force a particular index.

Default HNSW scanning returned zero eligible candidates in a varied indexed fixture containing 112 nearer incompatible chunks and 1,024 background vectors. Strict iterative scanning returned ten valid targets across three independent index builds, with about 100–106 ms SQL execution. The production Birth / English query similarly increased from 118 to 192 neighbors and from 14 to 20 ordered targets. Exact provenance remains before the neighbor limit.

The scan cap and the existing absolute deadline bound this extra work. No `ef_search` or scan-memory increase was needed. Tests use one pooled connection to prove planner and HNSW settings reset after both successful and failed retrieval transactions. See [pgvector's filtering and iterative-scan documentation](https://github.com/pgvector/pgvector#iterative-index-scans) for the underlying approximate-index behavior.

## Personalized retrieval

The existing profile query was also checked using one and two synthetic interests sourced inside SQL from public content chunks. No user profiles were accessed or vectors exported. The query produced eight nominations in 56.440 ms and sixteen in 86.359 ms. It retained its bitmap/parent-join/distance-sort plan. These samples do not demonstrate a profile-query timeout, so its SQL is unchanged; its performance at larger interest counts remains a follow-up diagnostic if live hybrid requests show trouble.

## Local release verification

The repair has its own worktree and PostgreSQL container. The approved September 8 `video-search` snapshot contains content and embeddings, without viewer or Admin-user records. The 1,492,155,290-byte archive passed source ETag/MD5 verification; SHA-256 is `e4ffbc71d9d0c38065774c90a312e58d030977bdd5bcf42d93b5a24c958e4530`. Restore uses the repository's archive, schema, and target preflight. Local PostgreSQL is 18.6 / pgvector 0.8.6, matching CI; production SQL checks above cover the deployed 0.8.2 extension.

The restored and analyzed catalog contains 1,175 videos, 212,171 dubs, 164,700 transcripts, and 280,107 embedded transcript chunks. All three snapshot database tests pass:

| Complete service path | Cold candidate pool | Warm candidate pool |        Delivered cards |
| --------------------- | ------------------: | ------------------: | ---------------------: |
| Semantic              |              308 ms |              185 ms |                      6 |
| Hybrid personalized   |              279 ms |              252 ms | 6 unique, no shortfall |

These local samples include retrieval, composition, signing, persistence, and serialization. Semantic delivery persisted 168 stage-evidence records and produced a 6,986-byte response. The fixture stubs admission and serving-state reads; hybrid uses synthetic private profile authority over real catalog vectors. “Cold” means a cold application candidate pool, not flushed database/OS caches or a cold production process. This is a complete-service gate on restored content, not a live HTTP/load test.

The [local SQL comparison](2026-09-09-recommendation-retrieval-verification/local-sql-summary.json) ran twice per input, reversing baseline/final order on the second repetition:

| Input           |             Original SQL |       Repaired SQL | Unique candidate videos |
| --------------- | -----------------------: | -----------------: | ----------------------: |
| Birth / English |     157.291 / 137.549 ms | 36.518 / 35.210 ms |                 14 → 20 |
| JESUS / English | 1,108.526 / 1,086.652 ms | 87.203 / 82.893 ms |                 36 → 36 |

JESUS reproduced the original index bypass locally: its baseline used the language index, while the repair used the English HNSW index with 48 rows per probe. Birth's baseline already used HNSW locally. No local diagnostic timed out; the 2,500 ms failures were observed in production. These differences reinforce why plans and timings need both representative local data and bounded production verification.

## Tests and review

- Nine deterministic database tests pass, including exact parent/chunk provenance, non-null transform rotation, missing active pointer, family exclusion, indexed retrieval with incompatible nearer vectors, complete semantic/hybrid service budgets, and connection-setting cleanup.
- Moving compatibility checks after a fixed 48-neighbor cap in an isolated mutation harness made the new eligibility test fail with zero candidates instead of twelve.
- Admin unit tests: 412 files and 6,232 tests passed initially. Two backup URI-parser tests encountered the task's target-restricted client wrapper; rerunning their complete 25-test file with the native PostgreSQL 18 client passed. No product-code fix was needed for those test-environment failures.
- Admin ESLint with zero warnings and final TypeScript checks pass. Review caught a type error in the indexed test's use of an unavailable scoped-client method; the test now rebuilds captured positional bindings as tagged SQL through the existing `$queryRaw` interface, and all nine database regressions pass again.
- Full repository formatting passes. Independent correctness, testing, maintainability, standards, agent parity, prior-learnings, performance, reliability, and TypeScript reviews completed. The test type error and collisions with newer roadmap IDs were corrected; unrelated existing roadmap ID collisions remain outside this repair.

Reproduce the database gates with a disposable local database only:

```bash
RECOMMENDATION_DB_TEST=1 RECOMMENDATION_DELIVERY_DB_FIXTURE=deterministic \
  pnpm --filter @forge/admin test -- src/services/recommendations/delivery-retriever.db.test.ts

RECOMMENDATION_DB_TEST=1 RECOMMENDATION_DELIVERY_DB_FIXTURE=production_snapshot \
  pnpm --filter @forge/admin test -- src/services/recommendations/delivery-retriever.db.test.ts
```

## Rollout and remaining product questions

This branch is not deployed. Use the normal PR-to-main deployment flow, then compare timeout rates and served/slate-fill rates by seed, locale/audio, strategy, and traffic mix. Track empty results separately from retrieval errors. A local speedup is not evidence of production recovery or greater helpfulness.

The SQL diagnostics establish a reproducible performance defect; they do not establish the exact historical rollout cause. Viewer-usage analytics remain in the local assessment and are not published here. Recommendation helpfulness still needs the separately scoped exposure/playback evidence and controlled personalization comparison.
