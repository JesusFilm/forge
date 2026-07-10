---
title: Admin hybrid search keyword-first mode — R4 extension pattern
category: platform
date: 2026-04-29
tags:
  [
    admin,
    search,
    keyword-first,
    lexical,
    tsvector,
    trigram,
    rrf,
    dilution-cap,
    debug,
    migration,
  ]
---

# Admin hybrid search keyword-first mode — R4 extension pattern

## Context

Sibling of `admin-hybrid-search-r4-pattern.md`. Captures the structural
shape of the keyword-first mode that extends R4's `HybridSearchService`,
shipped to admin in feat-109's destination-side port (apps/cms PR #852
was the source-side; admin is the canonical surface from R8 forward).

The cms-side feat-109 work is a one-shot port to admin's per-locale
Prisma schema. Same opt-in `mode="keyword-first"` contract, same
byte-identical-default invariant, same dilution cap and origin-gated
debug payload — implemented against admin's idioms (Prisma migrations,
`$queryRaw` template literals, `VideoLocale` per-locale rows) instead
of cms's Strapi v5 link-table model.

## The R4-extension invariants

1. **Byte-identical default.** `mode` unset / null / `""` / `"hybrid"`
   / unknown ⇒ R4 hybrid response, byte-identical. Locked in by
   `apps/admin/src/services/hybrid-search.regression.test.ts`. The test
   asserts `JSON.stringify(response)` equality across all five mode
   values against deterministic mocked retrievers.

2. **Single branched orchestrator.** One `HybridSearchService.search()`,
   one `if (pipelineMode === "keyword-first")` branch around the
   video-retrieval block. No twin functions, no strategy pattern.
   Per `docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md`.

3. **Hybrid path is UNTOUCHED.** R4's `searchVideoKeyword` (against
   `video_locale_fulltext_search_idx`) keeps running in hybrid mode.
   Keyword-first mode does NOT call it.

4. **`searchMode` (response) ⊥ `mode` (input).** Response `searchMode`
   is the embedding-degradation signal (`"hybrid"|"keyword-only"`).
   Input `mode` selects the pipeline. Same name, different concern.
   GraphQL schema description on `Query.search.mode` disambiguates
   explicitly.

5. **`mode` is a nullable String at the boundary, NOT an enum.**
   Future modes (`"instant"`, `"persona-aware"`) ship without
   GraphQL/REST schema changes. Unknown values warn-and-fall-back
   via a single sanitized log line; never throw.

## Schema delta — `0009_keyword_first_lexical`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "video_locale"
  ADD COLUMN IF NOT EXISTS "title_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED;

ALTER TABLE "video_locale"
  ADD COLUMN IF NOT EXISTS "description_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(description, ''))) STORED;

CREATE INDEX IF NOT EXISTS "video_locale_lexical_weighted_idx"
  ON "video_locale"
  USING GIN ((setweight(title_tsv, 'A') || setweight(description_tsv, 'B')));

CREATE INDEX IF NOT EXISTS "video_locale_title_trgm_idx"
  ON "video_locale"
  USING GIN (title gin_trgm_ops);
```

The byte-parity-guarded constants live in
`apps/admin/src/services/hybrid-search-sql.ts`:
`TITLE_TSV_GENERATED_EXPR`, `DESCRIPTION_TSV_GENERATED_EXPR`,
`WEIGHTED_TSV_INDEX_EXPR`, `WEIGHTED_TSV_QUERY_EXPR`. The trigram path
uses operator-class GIN — no shared constant; index selection by
operator (`%>`).

## Data-model divergences from cms feat-109

- **Title/description location.** cms: `videos.title` + `videos.description`
  (single-row). Admin: `VideoLocale.title` + `VideoLocale.description`
  (per-locale). New generated columns + GIN indexes attach to
  `video_locale`, not `video`.
- **Locale filter.** cms: `languages.bcp_47 = ?` via
  `video_variants_video_lnk → video_variants → video_variants_language_lnk → languages`
  link chain. Admin: `vl.locale = ?` (direct column on `video_locale`).
- **Migration mechanism.** cms: `ensure-search-lexical.ts` bootstrap
  hook with idempotent DDL on every boot. Admin: append-only Prisma
  migration `0009_keyword_first_lexical/migration.sql`. Same idempotency
  property at the migration layer.
- **Raw SQL idiom.** cms: `knex.raw(sql, [bindings])` with `?`
  placeholders + the cms `lexical-sql.ts` shared module. Admin: Prisma
  `$queryRaw` template literals + `Prisma.raw(EXPR)` for unbindable
  fragments. `Prisma.join` composes the variable-length ILIKE chain
  in `searchByExactTitle`.
- **Row return shape.** cms: rows mapped through `annotateVideo()` to
  inject `resultType`/`resultId`. Admin: retrievers return `RankedItem`-
  shaped rows directly (R4 already adopted this stronger pattern).

## Three keyword-first retrievers

`apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts`:

- **`searchByKeywordWeighted`** — `websearch_to_tsquery('simple', q)`
  for phrase-aware tsquery, ranked by `ts_rank_cd` over the per-field
  weighted tsvector. Title (weight A) outranks description (weight B).
  `Prisma.raw(WEIGHTED_TSV_QUERY_EXPR)` for the unbindable expression.

- **`searchByTrigram`** — `vl.title %> q` with `similarity(vl.title, q)`
  ranking. Title-only — description trigram index would balloon. Closes
  the typo / partial-prefix gap that `websearch_to_tsquery` misses.

- **`searchByExactTitle`** — dynamic AND-chain of `vl.title ILIKE ?`
  (one per token) composed via `Prisma.join`, ranked `LENGTH(title) ASC`.
  `MAX_EXACT_TITLE_TOKENS = 16` caps planner stack growth from
  pathological pasted queries (DoS guard from cms-side fix).
  `tokenizeForExactTitle` is Unicode-letter / digit split, lowercased,
  deduped.

All three honor R4's locale + status + `deleted_at IS NULL` chain
(`vl.locale = ? AND vl.status = 'published' AND v.deleted_at IS NULL`).
All three short-circuit to `[]` on empty / whitespace input without a
DB call. All three honor `OVERFETCH_FACTOR = 3` via the `limit` param.

## Branched orchestrator — `HybridSearchService.search()`

```
if mode === "keyword-first" && wantsVideos:
  start keyword-weighted-video + trigram-video + exact-title-video
  attach Promise.allSettled immediately
  ↓
embed(query)
  ↓
build final retrievals[]:
  if wantsVideos:
    push semantic-video                         (shared)
    if mode === "keyword-first":
      push pre-started keyword-weighted-video
      push pre-started trigram-video
      push pre-started exact-title-video
    else:                                        (hybrid path UNCHANGED)
      push keyword-video                         (R4)
  if wantsExperiences:
    push semantic-experience + keyword-experience  (shared, both modes)
allSettled → drop empty → fuseRankedLists(k=60)
  ↓ snapshot pre-cap fused scores into debugByKey
  ↓ if mode === "keyword-first" and SEARCH_DILUTION_CAP_ENABLED:
       applyDilutionCap(fused, labeledLists, query, debugByKey)
  ↓
deduplicateResults → paginate → mapToSearchResult
  ↓ if params.debug === true: attach debugByKey trace per result
return { results, hasMore, query, searchMode }
                                       ↑
                              UNCHANGED degradation signal
```

The three keyword-first video lexical retrievers do not need the query
embedding, so they may run while the embedding provider is in flight. Semantic
retrievers remain embedding-gated. Reuse the early settled outcomes in the final
retriever order; do not let async overlap change RRF list order or debug labels.

Timing attribution follows
`docs/solutions/performance-issues/admin-search-stage-db-timing-instrumentation-20260624.md`:
`db_retrievals_ms` is active retriever time, while `retrieval_wait_ms` is the
final await span. Overlapped stage timings are not additive.

## Semantic-dilution cap

Activates only in keyword-first mode AND only when at least one
exact-title row's lowercased title contains every query token. When
triggered:

- Aggregate top-3 (DILUTION_CAP_TOP_N) keyword-side `videoCoreId`s
  across `keyword-weighted-video`, `trigram-video`, `exact-title-video`
  → "this entity is genuinely a keyword winner" allowlist.
- For each fused result whose ONLY contributing list was
  `semantic-video` AND whose `videoCoreId` is null OR not in the
  allowlist: `score *= DILUTION_CAP_DOWNWEIGHT` (0.5). Re-sort.

Hard filtering is intentionally NOT used: thematic queries
(`q="hope when life is hard"`) have no exact-title trigger, so the
cap silently does nothing.

`SEARCH_DILUTION_CAP_ENABLED` defaults `true`. Only the literal string
`"false"` disables. Tolerant parser is a documented follow-up.

## Origin-gated debug payload

`apps/admin/src/services/hybrid-search-debug-allowlist.ts` is the soft
gate:

- `Origin: undefined` → fail closed.
- `SEARCH_DEBUG_ALLOWED_ORIGINS` CSV present → only listed origins.
- Otherwise → allowed iff `NODE_ENV !== "production"`.

Threat model: this is a soft feature flag, not auth. Origins are
forgeable from non-browser clients. The payload carries retriever
ranks + fused score + cap state — no PII, no credentials. Replace with
a token-based check before adding user-scoped data to the payload. Per
`docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`.

GraphQL types: `HybridSearchResultDebug` carries `retrieverRanks`
(an array of `HybridSearchRetrieverRank{ label, rank }`), `fusedScore`,
and `dilutionCapApplied`. The retriever labels are explicitly
**UNSTABLE** in the schema description — operators are the audience.

## Test gates

- **`hybrid-search-sql.test.ts`** — byte-parity vs migration `0009`.
  Generated-column expressions, weighted index expression, index
  names. Plus the legacy R4 `*_TSVECTOR_INDEX_EXPR` invariants.
- **`hybrid-search.regression.test.ts`** — gating snapshot. Five mode
  values, byte-identity, behavioral assertion that keyword-first
  retrievers are NEVER called on the default path. Test-first per
  `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`.
- **`hybrid-search-keyword-first-retrievers.test.ts`** — per-retriever
  shape + short-circuit + 16-token cap.
- **`hybrid-search.keyword-first.test.ts`** — orchestrator branch
  wiring, allSettled-isolated failures.
- **`hybrid-search.dilution-cap.test.ts`** — cap on/off, trigger
  condition, top-N exemption, null `videoCoreId` treated as outside,
  re-sort after down-weighting.
- **`hybrid-search.debug.test.ts`** — debug payload routing
  (params.debug true/false), per-result rank aggregation across
  multiple lists, dilutionCapApplied reflection.
- **`hybrid-search-debug-allowlist.test.ts`** — origin gate behavior
  across env + allowlist combinations.
- **`hybrid-search.bible-project.test.ts`** — headline acceptance
  test: top-3 are Bible Project for `q="the bible project"`.
- **REST `route.test.ts` + GraphQL `hybrid-search.test.ts`** — boundary
  origin gating, mode forwarding, `debug=true` only opt-in.

## Out-of-scope follow-ups

- **Real-DB integration tests** gated on R0 (Core sync entity coverage):
  EXPLAIN-based GIN verification, Bible Project headline against seeded
  data, canary diff vs cms keyword-first.
- **Consumer opt-ins** — apps/web now opts into Admin keyword-first at
  its shared search boundary; mobile and TV cutovers remain separate
  consumer-surface decisions.
- **Deprecating cms keyword-first** — happens at R8 alongside the rest
  of cms search deprecation. This work does NOT delete cms code.
- **`statement_timeout` for SQL retrievers** — pre-existing R4 concern;
  cross-cutting follow-up.
- **Tolerant parser for `SEARCH_DILUTION_CAP_ENABLED`** — currently
  only literal `"false"` disables.
- **Token-based debug auth** — current Origin gate is a soft feature
  flag. Replace if the payload starts carrying user-scoped data.
- **Apply lexical stack to experiences** — videos-only this round.

## See also

- `apps/cms` source-side: feat-109 (PR #852).
- Plan: `docs/plans/2026-04-29-002-feat-search-cms-to-admin-keyword-first-port-plan.md`.
- R4 sibling: `docs/solutions/platform/admin-hybrid-search-r4-pattern.md`.
- Web consumer opt-in: `docs/solutions/web/web-search-admin-keyword-first-opt-in.md`.
- Workflow miss this corrects:
  `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md`.
- Inherited-assumption discipline:
  `docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md`.
