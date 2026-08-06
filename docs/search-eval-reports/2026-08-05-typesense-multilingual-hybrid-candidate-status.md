# Typesense Multilingual Hybrid Candidate Status — 2026-08-05

## Decision

The implementation candidate is locally validated but is **not approved for
public traffic or baseline promotion**. `DEFAULT` remains unchanged. Remote
capacity, latency, development relevance, held-out relevance, and operator
review gates require the reviewed revision to reach the isolated
`@forge/admin/search` and Mastra shadow services through the normal PR process.

## Candidate Contract

- Localized Typesense title and metadata lanes share one small lexical
  collection with 25 explicit base-language tokenizers—including English,
  Chinese, and Thai—covering the fixed 30-locale evaluation corpus, plus a
  bounded fallback for long-tail locales.
- The active 280,107-document transcript collection remains the semantic lane.
  Routine releases reuse it and generate no new corpus embeddings.
- Admin sends the three lanes in one multi-search request and fuses canonical
  ranks at 56% title, 14% metadata, and 30% semantic.
- The shared query-embedding path has a bounded 256-entry process L1,
  provider/model/dimension identity, PostgreSQL L2, and identical-miss
  coalescing.
- Mastra's registered `absolute-search-eval` workflow has immutable development
  and held-out partitions, explicit Mandarin and Thai JESUS-family cases,
  deterministic title/semantic/multilingual/no-result metrics, pointwise
  judging, reviewed qrel input, exact candidate identity, and guarded promotion.

## Local Evidence

- Admin typecheck and lint: pass.
- Mastra typecheck and lint: pass.
- Admin full test suite: pass (production-sized Typesense was not started).
- Mastra full test suite: 165 files passed, 1 skipped; 1,723 tests passed, 3
  skipped.
- Focused behavior covers multilingual projection, canonical fusion, cache
  coalescing, the Admin MODERN eval endpoint, absolute metric math, pointwise
  judge parsing, held-out protection, and Mastra workflow registration.

## Required Remote Evidence

1. Routine index JSON says `transcriptReused: true`, reports all four aliases,
   correct counts, checked imports, zero retirement failures, lexical searchable
   bytes, and 2x/3x keyword memory estimates.
2. Typesense steady RSS is below 12 GiB, peak below 14 GiB, and at least 2 GiB
   remains free on the 16 GiB service.
3. One hundred accepted MODERN server requests and 100 full GraphQL requests
   are visible in Admin analytics with unique correlation IDs. Server p95 must
   be at most 250 ms and full-round-trip p95 at most 550 ms. Cache outcome and
   embedding/language/retrieval/watchability lane percentiles must explain the
   first-seen versus repeated-query difference.
4. The development partition is tuned without widening query count, HNSW work,
   or candidate windows unless paired latency remains within the retained
   candidate.
5. A frozen revision runs the held-out partition once. Complete reviewed
   relevance judgments, exact Admin revision plus four physical collection
   names, pointwise usefulness, multilingual/language correctness, honest
   expected-no-result behavior, canonical duplicate rate, semantic and
   product-title slices, and focused human review must all pass before any new
   baseline is promoted.

No remote measurement is claimed in this report yet.
