---
id: "feat-198"
title: "Keyword-first transcript relevance and entity search ranking"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-06-22"
duration: 4
depends_on:
  - "feat-192"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "keyword-first"
  - "semantic-search"
  - "embeddings"
  - "launch-readiness"
---

## Problem

Keyword-first search still fuses semantic-video and lexical retrievers through
RRF. After feat-192, semantic-video is transcript-only and production backfills
can mutate that live signal while they run. For brand/entity queries such as
`Bible Project`, generic fusion can let unrelated lexical matches combine with
semantic hits and outrank the known BibleProject corpus.

The observed brand/entity culprit is that `Bible` + `Project` in a description can be
treated too strongly. For example, "Rescue Project" rows can satisfy the token
shape lexically while BibleProject rows whose titles do not literally say
BibleProject depend on slug, core id, description, collection, or source
membership evidence. The ranker needs to understand BibleProject as a
source/corpus entity, not only as title text.

The second relevance gap is transcript signal quality for theological and felt
need queries. Enriched transcript chunks already store and embed felt needs,
Bible verses, content summary, tone, demographics, and spiritual context, but
`spiritualContext` is currently deterministic: it becomes `["Bible reference"]`
only when the chunk has an explicit Bible citation. This ticket owns the
vertical search-quality slice: improve the ranking behavior and the
transcript-grounded signals search relies on. Backfill operations, versioned
promotion, and source coverage are split into `feat-199`.

## Evidence

- Baseline export:
  `docs/search-eval-baselines/temporary/prod-seed-baseline-2026-06-02-export.json`
  includes `seed-bible-project` results where `The BibleProject Collection`
  ranked first, but adjacent leakage already existed.
- Mastra eval report:
  `docs/search-eval-reports/2026-06-03-local-english-post-batch-search-eval.json`
  passed in broad `hybrid` mode, but did not protect keyword-first brand/entity
  ranking.
- Current Watch/Admin path:
  `apps/web/src/lib/search.ts` requests `keyword-first`; Admin fuses
  `semantic-video`, `keyword-weighted-video`, `trigram-video`, and
  `exact-title-video` in `apps/admin/src/services/hybrid-search.service.ts`.
- Fusion is handled by `apps/admin/src/services/hybrid-search-fusion.ts`;
  retriever SQL is in `apps/admin/src/services/hybrid-search-retrievers.ts`.
- BibleProject videos often have identifying slug/core id/description/source
  evidence even when the visible title does not say `BibleProject`.
- Transcript-only keyword-first evals for BibleProject/entity behavior were
  completed in a separate branch. This ticket should consume that report as an
  input guardrail instead of recreating the eval work from scratch.
- Current enriched transcript planning sets `spiritualContext` in
  `apps/mastra/src/mastra/workflows/transcript-embedding.ts` from explicit
  Bible-verse extraction only.

## What To Build

1. Add a brand/entity recognition path before generic RRF for multi-token
   proper-name queries such as `Bible Project`.
2. When an exact title, known source, collection, slug, or corpus-membership
   match fires, rank that entity set first and let generic semantic retrieval
   fill after.
3. Treat description-only token matches as weaker than title/source/collection
   membership. Description text containing both `Bible` and `Project` must not
   outrank known BibleProject corpus rows by itself.
4. Expand source/corpus membership for BibleProject using the available Admin
   data: collection rows, slugs, core ids, descriptions, and any source
   metadata that reliably identifies BibleProject content.
5. Change semantic interaction for brand/entity queries: either downweight
   semantic contribution when entity evidence fires, or only allow semantic
   reranking inside the matched entity set before appending generic semantic
   fill results.
6. Use the existing transcript-only keyword-first eval branch/report for
   `Bible Project`, `the Bible project`, `BibleProject`, and agreed aliases as
   the guardrail for this ranking change. Only add new eval cases here if the
   report has an obvious coverage hole.
7. Improve transcript-grounded `spiritualContext` beyond the current explicit
   Bible-reference flag. Keep it subtitle/transcript-grounded, store it as
   structured metadata, and fold it into `embeddingInputText` so theological
   and discipleship queries can retrieve the right transcript chunks without
   reintroducing scene embeddings.

## Entry Points - Read These First

- `apps/admin/src/services/hybrid-search.service.ts` - keyword-first
  orchestration, retriever fusion, and public `semantic-video` family routing.
- `apps/admin/src/services/hybrid-search-fusion.ts` - RRF scoring and result
  merge behavior.
- `apps/admin/src/services/hybrid-search-retrievers.ts` - semantic transcript,
  lexical, trigram, and exact-title SQL retrievers.
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` -
  keyword-first lexical weighting patterns.
- `apps/admin/src/services/hybrid-search-retrievers.test.ts` and
  `apps/admin/src/services/hybrid-search-keyword-first-retrievers.test.ts` -
  existing retriever assertions.
- `apps/web/src/lib/search.ts` - Watch/Web caller that requests
  `keyword-first`.
- `apps/mastra/src/mastra/workflows/transcript-embedding.ts` - enriched
  transcript chunk planning, felt needs, demographics, Bible-verse extraction,
  and current deterministic `spiritualContext` behavior.
- `apps/admin/src/services/transcript-embedding.service.ts` and
  `apps/admin/src/services/transcript-embedding-ingest.service.ts` - Admin
  persistence of structured transcript metadata and vector payloads.
- `docs/search-eval-baselines/temporary/prod-seed-baseline-2026-06-02-export.json`
  - baseline evidence for `seed-bible-project`.
- `docs/search-eval-reports/2026-06-03-local-english-post-batch-search-eval.json`
  - broad hybrid eval report that missed this brand/entity regression.
- `docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md`
  - feat-192 contract for transcript-backed semantic evidence.
- `docs/solutions/architecture-patterns/transcript-demographics-signal-shape.md`
  - structured metadata plus embedded-text signal shape to follow for new
    spiritual-context behavior.

## Grep These

- `rg -n "keyword-first|keywordFirst|semantic-video|exact-title-video" apps/admin/src/services apps/web/src`
- `rg -n "BibleProject|Bible Project|Rescue Project|seed-bible-project" docs apps/admin/src`
- `rg -n "reciprocal|RRF|fuse|weighted" apps/admin/src/services/hybrid-search*`
- `rg -n "collection|source|slug|core_id|description" apps/admin/src/services/hybrid-search* apps/admin/prisma/schema.prisma`
- `rg -n "spiritualContext|spiritual_context|bibleVerses|feltNeeds|demographics" apps/mastra/src apps/admin/src`

## Constraints

- Preserve the existing frontend API contract; Watch should continue using the
  current search endpoint and mode.
- Do not re-enable scene embedding retrieval. `semantic-video` is the public
  family name, but its evidence should remain transcript-backed after feat-192.
- Brand/entity exactness should outrank description-only token coincidence, but
  generic semantic fill should still work after the entity set is exhausted.
- Do not reopen the already-completed transcript-only eval branch unless this
  implementation finds a specific missing case. Use its report as the
  acceptance guardrail.
- Do not handle staged/versioned embedding promotion here. That operational
  slice is `feat-199`.
- Keep spiritual-context extraction grounded in subtitle/transcript text and
  the allowed video-level context already passed to transcript embedding. Do
  not silently infer broad theology from unrelated catalog metadata.

## Acceptance Criteria

- `Bible Project`, `the Bible project`, and `BibleProject` return
  `The BibleProject Collection` or known BibleProject corpus children in the
  top slots.
- Rescue Project rows do not outrank known BibleProject corpus rows for
  BibleProject brand/entity queries unless the query adds Rescue-specific
  terms.
- Description-only `Bible` + `Project` evidence is weaker than
  title/source/collection/corpus-membership evidence.
- Semantic-video still contributes useful fill results, but it does not
  override strong brand/entity evidence.
- Keyword-first eval coverage fails before the ranking fix and passes after
  the fix.
- The eval report names the exact search mode, data source, and retriever
  strategy under test.
- Transcript chunks with obvious theological context can expose richer
  `spiritualContext` values than `["Bible reference"]`, and those values are
  both stored structurally and included in the embedded text.
- A search for theological/felt-need language benefits from transcript-backed
  metadata without any production path calling scene retrieval.
- `feat-199` exists as the separate operational safety ticket for versioned
  backfills and active-generation promotion.

## Verification

- Add focused Admin service tests around entity detection, retriever weighting,
  and fusion behavior.
- Reuse the completed transcript-only keyword-first eval branch/report and add
  only the missing fixtures needed for this implementation.
- Add focused Mastra transcript-planning tests for richer `spiritualContext`
  extraction and embedding input text.
- Add Admin ingest/service tests proving the richer structured metadata still
  persists and is not dropped during transcript embedding writes.
- Run a production-like eval before and after the ranking change and compare
  BibleProject/Rescue Project ordering.
- Confirm the Watch frontend continues to call the same search API contract;
  this should be a backend ranking/eval change, not a frontend API change.
