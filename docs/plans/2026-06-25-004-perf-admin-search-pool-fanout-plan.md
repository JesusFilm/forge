---
title: "perf: Tune Admin search pool and lexical fan-out"
type: "perf"
date: "2026-06-25"
execution: "code"
---

# perf: Tune Admin search pool and lexical fan-out

## Summary

Run a production pool-size experiment for Admin search, keep the pool setting
only if it improves representative canaries without changing results, then
reduce keyword-first video lexical DB connection fan-out while preserving the
same retriever lists and ranking inputs.

---

## Problem Frame

Production search timings still show multi-second `keyword-first` responses
even after the semantic DB retrieval safe slice. A production-shaped
`EXPLAIN ANALYZE` for the current semantic-video SQL executed in tens of
milliseconds, while app-observed DB timings remain in repeated hundreds-of-ms
bands. That points at connection acquisition, Prisma/Railway runtime overhead,
and fan-out pressure as the next safest optimization target.

The roadmap ticket keeps HNSW-first semantic retrieval deferred until parity is
proven. This plan therefore works on result-preserving operational and query
orchestration changes first.

---

## Requirements

- R1. Production pool changes must not alter search SQL, rankings, result IDs,
  result order, snippets, images, playback IDs, `searchMode`, or `hasMore`.
- R2. The pool-size experiment must compare the same representative queries:
  `the bible project`, `jesus`, and `hope when life is hard`.
- R3. The code change must keep `semantic-video`, `keyword-weighted-video`,
  `trigram-video`, and `exact-title-video` as separate RRF lists.
- R4. Keyword-first lexical video retrieval must reduce DB connection fan-out
  without changing the existing lexical SQL predicates, limits, or row mapping.
- R5. Validation must compare speed and result signatures before and after the
  production change.
- R6. HNSW-first remains out of scope for this PR.

---

## Key Technical Decisions

- **Start with an env-only pool experiment:** Admin Railway dashboard env is
  authoritative, and `apps/admin/railway.toml` is documented as dead config.
  Tune `DATABASE_URL` in production first so the lowest-risk change is measured
  before code changes.
- **Use the existing documented pool target first:** Start with
  `connection_limit=10&pool_timeout=20`, matching the comment in
  `apps/admin/src/db/client.ts`, while watching for DB connection pressure.
- **Batch lexical video reads through one connection:** Keep the three existing
  keyword-first SQL functions, but run them inside one transaction-scoped helper
  from the orchestrator. This reduces pool fan-out more safely than rewriting
  all three SQL shapes into one new UNION query.
- **Preserve RRF inputs:** The service still exposes three labeled lexical
  lists to fusion and debug attribution; only their DB connection scheduling
  changes.

---

## Implementation Units

### U1. Run and retain the production pool experiment

- **Goal:** Prove whether production pool settings reduce search latency before
  code changes.
- **Requirements:** R1, R2, R5
- **Dependencies:** none
- **Files:**
  - `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
  - `docs/solutions/performance-issues/`
- **Approach:** Capture baseline result signatures and timings, update the
  production Admin `DATABASE_URL` pool query parameters in Railway, wait for
  deployment/restart, then rerun the same canaries. Keep the env change only if
  timings improve and result signatures remain stable.
- **Patterns to follow:** `apps/admin/CLAUDE.md`; `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`.
- **Test scenarios:** Test expectation: none -- this unit is an operational
  experiment whose proof is production timing/result comparison.
- **Verification:** Report before/after service timing, client timing,
  `semantic-video.query` timing, DB timing fields, and top result signatures.

### U2. Batch keyword-first video lexical DB fan-out

- **Goal:** Reduce keyword-first video lexical connection pressure while
  preserving exact retriever outputs.
- **Requirements:** R3, R4
- **Dependencies:** U1
- **Files:**
  - `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts`
  - `apps/admin/src/services/hybrid-search.service.ts`
  - `apps/admin/src/services/hybrid-search-keyword-first-retrievers.test.ts`
  - `apps/admin/src/services/hybrid-search.keyword-first.test.ts`
  - `apps/admin/src/services/hybrid-search.bible-project.test.ts`
  - `apps/admin/src/services/hybrid-search.debug.test.ts`
  - `apps/admin/src/services/hybrid-search.dilution-cap.test.ts`
  - `apps/admin/src/services/hybrid-search.regression.test.ts`
- **Approach:** Add a `searchKeywordFirstVideoLexical` helper that runs
  `searchByKeywordWeighted`, `searchByTrigram`, and `searchByExactTitle` inside
  one Prisma transaction. Update `HybridSearchService` to start that helper
  before embedding resolves, then split the returned lists back into the
  existing RRF labels.
- **Patterns to follow:** Existing keyword-first retriever tests and
  `SearchTimingRecorder` DB timing labels.
- **Test scenarios:**
  - The batch helper returns the same three arrays produced by the individual
    retrievers.
  - The batch helper uses one Prisma transaction and preserves the individual
    DB timing labels from the existing functions.
  - Keyword-first still starts lexical work while query embedding is pending.
  - Keyword-first still does not dispatch the legacy hybrid keyword retriever.
  - Bible Project and dilution-cap orchestrator fixtures keep the same ranked
    result behavior.
- **Verification:** Focused Admin search tests pass.

### U3. Merge, deploy, and compare production speed/results

- **Goal:** Validate that the retained pool setting plus code change improves
  real production latency without result regression.
- **Requirements:** R1, R2, R5
- **Dependencies:** U2
- **Files:**
  - `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
  - `docs/solutions/performance-issues/`
- **Approach:** Merge the PR to `main`, let production deploy, then rerun the
  same canaries. Compare new timing distributions against the pre-pool and
  post-pool/pre-code snapshots, and compare top result IDs and displayed fields.
- **Patterns to follow:** Existing production search timing probes and
  `event=search_timing` log parsing.
- **Test scenarios:** Test expectation: none -- this unit is deployment
  measurement and reporting.
- **Verification:** Final report includes whether results stayed the same and
  whether service/client timings improved enough to proceed or rethink.

## Scope Boundaries

- HNSW-first semantic retrieval is deferred to a separate gated prototype.
- This work does not change public Web search UI behavior.
- This work does not change ranking weights, RRF constants, overfetch limits,
  or semantic evidence selection.

## Sources / Research

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/plans/2026-06-25-003-perf-admin-search-semantic-db-retrieval-plan.md`
- `apps/admin/src/db/client.ts`
- `apps/admin/src/services/hybrid-search.service.ts`
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts`
