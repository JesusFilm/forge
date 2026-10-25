---
title: "feat(cms): search — opt-in keyword-first lexical mode (impl plan)"
type: feat
status: active
date: 2026-04-29
origin: docs/roadmap/content-discovery/feat-109-search-keyword-first-mode.md
supersedes: docs/plans/2026-04-28-001-feat-search-keyword-first-mode-plan.md
---

# feat(cms): search — opt-in keyword-first lexical mode (impl plan)

## Overview

Add an opt-in lexical retrieval mode to the existing `apps/cms` search
pipeline. Reachable only when callers explicitly pass `mode="keyword-first"`
on `GET /api/search` (REST) or `Query.semanticSearch(... , mode: "keyword-first")`
(GraphQL). Default behavior — and behavior for every existing consumer
(`apps/web`, `apps/mobile`, `apps/tv`) — stays byte-identical to `main`.

This refines the merged plan at
`docs/plans/2026-04-28-001-feat-search-keyword-first-mode-plan.md`
against the actual repo state. Key deltas: actual retriever module split,
naming collision with the existing `searchMode` response field, pre-existing
legacy GIN index in `ensure-pgvector.ts`, and the orchestrator's existing
4-list multi-content-type structure that the new mode must compose with.

## Problem Frame

Three behaviors in the current orchestrator dilute title-driven queries:

- `plainto_tsquery('simple', q)` flattens the query to `term1 & term2 & …`,
  so phrase adjacency is lost.
- The keyword tsvector is `to_tsvector('simple', coalesce(v.title, '') || ' '
|| coalesce(v.description, ''))` — title and description hits weigh
  equally (`apps/cms/src/api/search/services/keyword-search.ts:57`).
- pgvector cosine has no notion of phrases. For `q="the Bible project"` it
  surfaces videos thematically near "bible / ministry / project," not just
  the Bible Project series. RRF fuses the diluted lists and the tail leaks
  into the top results.

The team's research report concluded these improvements should land as
nullable additions on the existing resolver, preserving the default
contract for every current consumer (see origin:
`docs/research/semantic-search-report.md` §6.2, §7).

## Requirements Trace

- **R1.** Add a nullable `mode` argument (REST query param + GraphQL
  nullable `String` arg) accepting `"hybrid"` (default, current behavior)
  and `"keyword-first"` (new lexical stack). Unknown values fall back to
  hybrid with a structured warning log; never error.
- **R2.** Default behavior is byte-identical to `main`. When `mode` is unset
  or `"hybrid"`, the response (id list + ranking + score rounding) matches
  `main` exactly for a fixed regression query set. Locked in by a snapshot
  test that runs throughout the PR.
- **R3.** `mode="keyword-first"` activates the new video lexical stack:
  phrase-aware tsquery (`websearch_to_tsquery`), per-field weighted
  tsvector (`title_tsv` weight A, `description_tsv` weight B), trigram
  matching on `videos.title`, exact-phrase-in-title retriever as the
  4th RRF list. Experience retrievals (semantic + keyword) stay unchanged
  in either mode.
- **R4.** DB infrastructure (`pg_trgm` extension, weighted generated
  columns, GIN indexes) is shared but dormant on the hybrid path. The
  default keyword path continues to read `videos_fulltext_search_idx`
  (already provisioned in `ensure-pgvector.ts:96-103`) plus
  `plainto_tsquery` exactly as today.
- **R5.** Optional `debug=true` (REST query param + GraphQL arg)
  surfaces per-retriever scores, origin-gated to the existing CORS
  allowlist (localhost + staging). Available in either mode.
- **R6.** Strapi-first ship. `apps/admin` R4 port is a separate
  follow-up.
- **R7.** Cutover (flipping the default to `"keyword-first"`) is
  documented but not executed in this PR.

## Scope Boundaries

**In scope:**

- `mode` argument plumbed through REST handler, GraphQL resolver, and
  `search()` orchestrator. Default `"hybrid"`.
- New bootstrap module: `pg_trgm` extension; `videos.title_tsv` (weight
  A) + `videos.description_tsv` (weight B) generated columns; weighted
  GIN index on `setweight(title_tsv,'A') || setweight(description_tsv,'B')`;
  GIN trigram index on `videos.title`.
- New per-retriever modules: `searchByKeywordWeighted`, `searchByTrigram`,
  `searchByExactTitle`. Existing `searchByKeyword` and `searchBySemantic`
  stay untouched.
- Branched orchestrator: in `mode="keyword-first"`, the **video** retrieval
  set goes from 2 lists (semantic + keyword) to 4 (semantic + keyword-weighted
  - trigram + exact-title). Experience retrievals are unchanged in either mode.
- Semantic-dilution cap behind `SEARCH_DILUTION_CAP_ENABLED` (default
  on for keyword-first, no-op for hybrid).
- Origin-gated `debug` field on response.
- Default-mode regression snapshot test (gating).
- Keyword-first acceptance test for `q="the Bible project"` (gating).
- Cutover plan documented in this plan; cutover itself out-of-scope.

**Out of scope (deferred follow-ups):**

- Flipping the default from `"hybrid"` to `"keyword-first"`.
- Synonyms / stopwords / brand dictionaries.
- Persona / demographic facets and ranking.
- Multilingual query handling (per-locale embedding model, locale-
  specific tokenization).
- Click-through telemetry.
- `mode="instant"` latency variant from §6.2 of the report.
- `apps/admin` R4 port.
- Applying the lexical stack to `experiences` (videos only this round).

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/search/services/search.ts` — orchestrator. Already
  composes up to 4 retrievals (videos × experiences × {semantic, keyword})
  via `Promise.allSettled` with labels and the `annotateVideo` helper.
  `mode` plumbing and the keyword-first video-retrieval branch hook in here.
- `apps/cms/src/api/search/services/keyword-search.ts` — exports
  `searchByKeyword`. Stays untouched; new weighted retriever lands as
  a sibling file.
- `apps/cms/src/api/search/services/semantic-search.ts` — exports
  `searchBySemantic`. Untouched.
- `apps/cms/src/api/search/services/fusion.ts` — `fuseRankedLists(lists,
k)` already accepts N lists and namespaces results by
  `${resultType}:${resultId}`. Already filters empty lists in the caller
  (`search.ts:262`). 4-list fusion in keyword-first mode is a no-op for
  the fusion API itself.
- `apps/cms/src/api/search/controllers/search.ts` — REST handler. Pattern
  for accepting and validating optional query params (`type`, `limit`,
  `offset`) is established; `mode` follows the same shape.
- `apps/cms/src/graphql/search.ts` — GraphQL extension registering
  `Query.semanticSearch`. Pattern for nullable `String` args is
  established (`type: String` on the typedef; optional field on `args`).
- `apps/cms/src/bootstrap/ensure-pgvector.ts` — idempotent `CREATE
EXTENSION IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` pattern.
  **Note:** already creates `videos_fulltext_search_idx` (concatenated
  tsvector) at lines 96–103. The new bootstrap module adds _new_ indexes
  alongside; the legacy index stays in place to keep hybrid mode fast.
- `apps/admin/src/services/hybrid-search-sql.ts` — R4 byte-parity
  pattern: lift the tsvector / trigram expression into a shared TS
  constant; assert byte-equality between bootstrap SQL and retriever SQL
  in a unit test.
- `apps/cms/src/api/search/services/keyword-search.test.ts` — SQL-text
  assertion pattern (`expect(sql).toContain(...)`). Mirror for new
  retrievers.
- `apps/cms/src/api/search/services/search-health.ts` — process-local
  counters / structured warn pattern. Mirror the
  `event=search_unknown_mode mode=… falling_back=hybrid` log shape.

### Institutional Learnings

- **`docs/solutions/platform/admin-hybrid-search-r4-pattern.md`** — canonical
  RRF + warn-and-fallback contract; structured log shape
  `[search] event=… error_class=… message=…`.
- **`docs/solutions/best-practices/rrf-fusion-heterogeneous-content-types-20260415.md`**
  — empty-list filtering before normalization, `${type}:${id}` namespacing.
  The current orchestrator already does both; the keyword-first branch
  must preserve that.
- **`docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md`**
  — `ensure-pgvector.ts` is the bootstrap idempotency reference.
- **`docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`**
  — same lesson applies to GIN: query expression must match index
  expression byte-for-byte, or planner falls back to Seq Scan.
- **`docs/solutions/database-issues/set-local-requires-transaction-for-pgvector-search.md`**
  — if any `SET LOCAL pg_trgm.similarity_threshold = …` tuning is added,
  it must run inside the same `$transaction` as the query.
- **`docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`**
  — pattern for asserting on raw-SQL text in tests (`DISTINCT ON`, locale
  joins, byte-parity invariants). Applies to GIN parity tests.
- **`docs/solutions/runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md`**
  — graceful-degradation precedent for warn-and-fallback logging.
- **`docs/solutions/security-issues/yoga-cors-origin-undefined-allows-all-origins.md`**
  — for the `debug` field, fail closed when origin is `undefined`.
- **`docs/solutions/cms/codegen-strips-optional-graphql-variables.md`** —
  consumers passing `mode` via codegen-generated documents must verify the
  variable definition survives. Out of scope for this PR (cms only) but
  noted for downstream consumer work.

### External References

Skipped — Postgres `pg_trgm`, `websearch_to_tsquery`, weighted tsvector,
and RRF are well-established primitives with strong local reference
patterns (admin R4) that should be mirrored for consistency.

## Key Technical Decisions

- **Opt-in via `mode` argument; default behavior byte-identical.** Per the
  origin report (§6.2, §7) and the user's hard constraint. Locked in by
  the regression snapshot test introduced before any keyword-first code.

- **`mode` is a nullable String, not a closed enum.** Default `"hybrid"`.
  Unknown values warn-and-fallback. Future modes (`"instant"`,
  `"persona-aware"`) ship as new values without schema changes.

- **`mode` (input) ≠ `searchMode` (response).** The response already
  carries `searchMode: "hybrid" | "keyword-only"`, a degradation signal
  introduced by feat-097 (it indicates whether the embedding call
  succeeded). The new input arg `mode` is orthogonal — it selects which
  retrieval stack to run. We keep both names; the regression test asserts
  `searchMode` semantics are unchanged in either input mode. The naming
  collision is explicitly documented in the GraphQL typedef description
  to avoid consumer confusion.

- **Branched orchestrator, not twin functions.** A single `search()` with
  `if (mode === "keyword-first") { … } else { … }` for the video
  retrieval block. Experience retrievals, embedding step, fusion call,
  dedup, and pagination remain shared. This satisfies the "single
  orchestrator" hard constraint and avoids forking a 100-line function.

- **DB infrastructure shared, code paths separated.** New bootstrap module
  installs `pg_trgm`, `title_tsv`, `description_tsv`, the weighted GIN
  index, and the trigram GIN index. The legacy `videos_fulltext_search_idx`
  is left untouched so the hybrid path is unaffected. New columns are
  generated (`STORED`), so they fill automatically on insert/update;
  no backfill job needed.

- **`websearch_to_tsquery` over `phraseto_tsquery`.** Both preserve phrase
  adjacency; `websearch_to_tsquery` accepts user double-quotes as exact
  phrases (Algolia-like) and degrades gracefully on unquoted input.

- **Trigram on `videos.title` only.** Description is long, low-signal for
  typo/prefix matching, and would balloon the index. Title trigram covers
  the Bible Project case.

- **Exact-phrase boost as a discrete RRF list, not a multiplier.** Keeps
  the fusion pipeline uniform — `fuseRankedLists` already supports N lists.

- **Semantic-dilution cap as a soft 0.5× down-weight.** Hard filtering
  breaks long-tail thematic queries. Cap kicks in only when an
  exact-title hit exists in the keyword-side top-N; behind
  `SEARCH_DILUTION_CAP_ENABLED` so it can be toggled at runtime.

- **`debug` is dev-only and origin-gated.** Reuse the existing CORS
  allowlist; strip the field for non-allowlisted origins. **Fail closed**
  when `Origin` is `undefined` (cms is not an authenticated origin
  surface today; `undefined` from a non-browser client must not
  default-allow).

- **Test-first sequencing on Unit 2.** Default-mode regression snapshot
  lands BEFORE any `mode` plumbing or keyword-first retrieval code, so
  the byte-identical guarantee is enforced from the first behavior change
  onward.

- **New retrievers as sibling files, not appended to `keyword-search.ts`.**
  Mirrors the existing one-file-per-retriever shape (`keyword-search.ts`,
  `semantic-search.ts`, `experience-keyword-search.ts`,
  `experience-semantic-search.ts`).

## Open Questions

### Resolved During Planning

- **Default-replace vs opt-in?** Opt-in. Per origin report §6.2/§7 and
  hard constraint.
- **cms or admin?** cms first; admin R4 port is a follow-up.
- **Multiplier vs ranked list for exact-title?** Ranked list.
- **`pg_trgm` scope?** `videos.title` only.
- **Naming collision: rename input `mode` to `retrievalMode` to avoid
  confusion with response `searchMode`?** No. The merged ticket and
  origin report name it `mode`. Rename has consumer-coordination cost
  (apps/web/mobile/tv would need to switch). Document the distinction in
  the GraphQL typedef and the regression test instead.
- **Replace or coexist with `videos_fulltext_search_idx`?** Coexist.
  Replacing it would be a default-behavior change.
- **One retriever module file, or per-retriever files?** Per-retriever
  files — matches existing convention.
- **One PR or two?** Unit 1 ships as PR-A (DB-only, dormant). Units 2–5
  ship as PR-B with the regression test as the first commit. Two-PR split
  isolates the DB migration risk and keeps the behavioral PR tractable.

### Deferred to Implementation

- **Final dilution-cap down-weight constant** — start at 0.5×; tune
  against the acceptance test and a small canary set. Final value goes
  in PR-B description.
- **Final `top-N` window for the dilution-cap trigger** — start at 3.
- **Whether the GIN byte-parity test lives as a service-module unit
  test or migration-side test** — mirror the admin R4 placement
  (service-module side).
- **`pg_trgm.similarity_threshold` tuning** — only tune if EXPLAIN shows
  poor recall on `videos.title %> q`; if needed, wrap in `$transaction`
  with `SET LOCAL` per institutional learning.
- **Exact `bcp_47` set used in the regression seed** — pick the locales
  the seed already covers (`en`, `es`); confirm by inspecting test
  fixtures during implementation.
- **GraphQL `debug` shape on the response** — added as an optional field
  on `SearchResponse`. Final field name and nullability decided when the
  resolver is touched (`debug` vs `debugPayload`).

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for
> review, not implementation specification. The implementing agent should
> treat it as context, not code to reproduce._

The orchestrator branches on `mode` exactly once, around the **video**
retrieval block. Embedding, experience retrievals, fusion, dedup, and
pagination are shared.

```
search(strapi, { query, locale, mode?, debug?, contentTypes?, limit?, offset? })
  │
  ├── normalize mode:  unset|"hybrid" → hybrid
  │                    "keyword-first" → keyword-first
  │                    else → log structured warn, fallback to hybrid
  │
  ├── embed(query)  // unchanged; failure → keyword-only degradation
  │
  ├── build retrievals[]:
  │     if wantsVideos and mode == hybrid:                ← UNCHANGED
  │       L_v_sem  = searchBySemantic(...)
  │       L_v_kw   = searchByKeyword(...)
  │     if wantsVideos and mode == keyword-first:         ← NEW PATH
  │       L_v_sem  = searchBySemantic(...)
  │       L_v_kwW  = searchByKeywordWeighted(...)         // websearch_to_tsquery + weighted tsv
  │       L_v_trg  = searchByTrigram(...)                 // videos.title %> q
  │       L_v_exct = searchByExactTitle(...)              // every token in title
  │     if wantsExperiences:                              ← UNCHANGED in either mode
  │       L_e_sem  = searchByExperienceSemantic(...)
  │       L_e_kw   = searchByExperienceKeyword(...)
  │
  ├── allSettled, drop empty lists, fuseRankedLists(k=60)
  │
  ├── if mode == keyword-first and SEARCH_DILUTION_CAP_ENABLED
  │      and exact-title list has at least one hit:
  │        topN_kw_core_ids = ∪ core_ids of top-N from L_v_kwW, L_v_trg, L_v_exct
  │        for each fused result that contributed only via L_v_sem
  │            and result.videoCoreId ∉ topN_kw_core_ids:
  │              result.score *= 0.5
  │        re-sort
  │
  ├── deduplicateResults(...)  // unchanged 3-layer
  ├── paginate(limit, offset)
  ├── if debug allowed → attach { retrieverScores, fusedScore, dilutionCapApplied } per result
  └── return { results, hasMore, query, searchMode }
                                          ↑
                            unchanged degradation signal
                            ("hybrid"/"keyword-only")
```

The hybrid branch reads no new columns and gains no new dependencies.
The two paths share `embedQuery`, `fuseRankedLists`, `deduplicateResults`,
and the pagination tail.

## Implementation Units

> **Sequencing.** Unit 1 is PR-A (DB-only, dormant — safe to ship first).
> Units 2–5 are PR-B; within PR-B, Unit 2's regression snapshot is the
> first commit, Units 3–5 follow.

### Unit 1: Bootstrap module — `pg_trgm`, weighted tsvector columns, new GIN indexes

**Goal:** Provision DB infrastructure both modes can sit on. Idempotent;
populated regardless of mode; dormant when `mode="hybrid"`.

**Requirements:** R3, R4

**Dependencies:** None.

**Files:**

- Create: `apps/cms/src/bootstrap/ensure-search-lexical.ts`
- Create: `apps/cms/src/bootstrap/ensure-search-lexical.test.ts`
- Modify: wherever `ensurePgvector` is invoked at app boot — add
  `ensureSearchLexical` invocation alongside it (search the bootstrap
  entrypoint during implementation).
- Create: `apps/cms/src/api/search/services/lexical-sql.ts` — exports the
  weighted-tsvector and trigram-match SQL fragments as `const` strings
  so the new retrievers (Unit 3) and bootstrap (this unit) reference the
  same source of truth (byte-parity invariant).

**Approach:**

- Mirror `ensure-pgvector.ts`'s shape: outer try/catch warns and continues
  if pg_trgm isn't installable (e.g. shared-host dev DBs); inner block
  runs idempotent DDL.
- Statements (in order):
  1. `CREATE EXTENSION IF NOT EXISTS pg_trgm`
  2. `ALTER TABLE videos ADD COLUMN IF NOT EXISTS title_tsv tsvector
GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '')))
STORED`
  3. Same for `description_tsv` over `coalesce(description, '')`
  4. `CREATE INDEX IF NOT EXISTS videos_lexical_weighted_idx
ON videos USING gin (
  (setweight(title_tsv, 'A') || setweight(description_tsv, 'B'))
)`
  5. `CREATE INDEX IF NOT EXISTS videos_title_trgm_idx
ON videos USING gin (title gin_trgm_ops)`
- Lift the _exact_ expressions used in (4) and (5) into `lexical-sql.ts`
  as `WEIGHTED_TSV_EXPR` and `TITLE_TRIGRAM_OP` string constants.
  Bootstrap composes its DDL from those constants. Unit 3's retrievers
  reuse them. The byte-equality test asserts both call sites use the
  literal constant.
- Do NOT touch `videos_fulltext_search_idx` — legacy hybrid path still
  reads it.

**Patterns to follow:**

- `apps/cms/src/bootstrap/ensure-pgvector.ts` (idempotent shape, warn-and-continue)
- `apps/admin/src/services/hybrid-search-sql.ts` (byte-parity assertion)

**Test scenarios:**

- Bootstrap is safe to run twice in a row against the same DB.
- The exported `WEIGHTED_TSV_EXPR` and `TITLE_TRIGRAM_OP` constants
  appear verbatim in the SQL the bootstrap emits (string-equality test).
- After bootstrap, `videos.title_tsv` and `videos.description_tsv`
  columns are present and populated for an inserted fixture row.
- `EXPLAIN` on a `WHERE title %> 'bible project'` against the
  fixture-seeded table shows `Bitmap Index Scan` on `videos_title_trgm_idx`.
- Bootstrap emits a structured warn (not a throw) when `CREATE EXTENSION
pg_trgm` is denied (simulated by stubbing `knex.raw`).

**Verification:**

- All four objects (pg_trgm extension, two generated columns, two new GIN
  indexes) exist after deploy. `pg_size_pretty(pg_total_relation_size())`
  for both new indexes recorded in PR-A description.
- Hybrid path's `searchByKeyword` query plan unchanged from `main`.

### Unit 2: `mode` plumbing + default-mode regression snapshot (test-first)

**Goal:** Plumb the `mode` arg from REST + GraphQL through `search()`
with hybrid as the default. Lock in byte-identical default behavior with
a snapshot test that runs from this point through every subsequent unit.

**Requirements:** R1, R2

**Dependencies:** Unit 1 (so the migration is in place; not strictly
required for behavior but keeps the branch buildable end-to-end).

**Files:**

- Create: `apps/cms/src/api/search/services/search.regression.test.ts`
  (the snapshot test — lands first, against unmodified `main` behavior).
- Modify: `apps/cms/src/api/search/controllers/search.ts` — accept and
  validate `mode` query param; pass through to service.
- Modify: `apps/cms/src/graphql/search.ts` — add `mode: String` to the
  typedef with a description that disambiguates from the response
  `searchMode` field; thread to the service call.
- Modify: `apps/cms/src/api/search/services/search.ts` —
  - Extend `SearchParams` with `mode?: string`.
  - Add `normalizeMode(raw): "hybrid" | "keyword-first"` helper that
    returns `"hybrid"` for unset/null/`"hybrid"`, `"keyword-first"` for
    that exact value, and warns + returns `"hybrid"` otherwise.
  - In this unit, only the hybrid branch is reachable; `"keyword-first"`
    parses successfully but routes to hybrid behavior (Unit 3 wires the
    actual keyword-first retrievals in).
- Modify: `apps/cms/src/api/search/services/search.test.ts` — extend
  with cases for `mode` parsing + warn-and-fallback.

**Execution note:** Test-first. The regression snapshot test is the
**first commit on PR-B** and is captured by running it once against
`origin/main` before any other change lands. The captured snapshot is
checked in. Subsequent commits must keep that snapshot green.

**Approach:**

- Default `"hybrid"` when `mode` is unset, null, or `""`.
- Unknown values: emit `strapi.log.warn(\`[search]
  event=search_unknown_mode mode=\${raw} falling_back=hybrid\`)` exactly
  once per call; never throw.
- Regression query set (matches the merged ticket):
  - `q="the Bible project"`, `locale="en"`, `limit=10`
  - `q="forgiveness"`, `locale="en"`, `limit=10`
  - `q="easter"`, `locale="en"`, `limit=10`
  - `q="resurrection"`, `locale="es"`, `limit=10`
  - `q="  "` (whitespace) — current 400/empty behavior preserved
  - Each query run with `mode` unset, `mode=""`, `mode="hybrid"`,
    `mode="garbage"` — all four must produce byte-identical responses.
- Snapshot stored as a JSON fixture next to the test. Use a deterministic
  seed (existing test seed if one exists; otherwise document the seed
  hash in the PR).

**Patterns to follow:**

- REST query-param parsing pattern in
  `apps/cms/src/api/search/controllers/search.ts:51-58` (the existing
  `type` validation).
- GraphQL nullable arg pattern in `apps/cms/src/graphql/search.ts`
  (existing `type: String` arg).
- Structured warn shape from
  `apps/cms/src/api/search/services/search.ts:196` (`event=… error_class=…`).

**Test scenarios:**

- `mode` unset → byte-identical response to `main` for the regression
  query set.
- `mode=""` and `mode="hybrid"` → byte-identical to `main`.
- `mode="garbage"` → byte-identical response + exactly one warn log
  with the structured shape.
- REST `?mode=keyword-first` parses and is forwarded (returns hybrid
  behavior in this unit; keyword-first wiring lands in Unit 3).
- GraphQL `mode: null` and missing `mode` argument both default to
  hybrid.
- GraphQL `mode: "garbage"` → hybrid behavior + warn log; never throws
  GraphQL error.
- `searchMode` response field still reports
  `"hybrid"|"keyword-only"` based solely on embedding success/failure
  (orthogonal to input `mode`).

**Verification:**

- `search.regression.test.ts` passes on this branch.
- `search.regression.test.ts` would also pass when checked out at
  `origin/main` (with the file copied in) — the snapshot is the
  pre-change baseline.

### Unit 3: Keyword-first retrievers + branched orchestrator

**Goal:** Implement the new lexical retrievers and wire the keyword-first
video-retrieval branch into the orchestrator. Hybrid path remains untouched.

**Requirements:** R3, R4

**Dependencies:** Unit 1 (DB infra), Unit 2 (`mode` plumbing).

**Files:**

- Create: `apps/cms/src/api/search/services/keyword-weighted-search.ts` —
  exports `searchByKeywordWeighted` (`websearch_to_tsquery` against
  `WEIGHTED_TSV_EXPR`).
- Create: `apps/cms/src/api/search/services/keyword-weighted-search.test.ts`
- Create: `apps/cms/src/api/search/services/trigram-search.ts` — exports
  `searchByTrigram` (`videos.title %> ?` using `TITLE_TRIGRAM_OP`,
  ranked by `similarity()`).
- Create: `apps/cms/src/api/search/services/trigram-search.test.ts`
- Create: `apps/cms/src/api/search/services/exact-title-search.ts` —
  exports `searchByExactTitle` (every whitespace-tokenized term present
  in `videos.title` case-insensitive; ranked by title length ascending).
- Create: `apps/cms/src/api/search/services/exact-title-search.test.ts`
- Create: `apps/cms/src/api/search/services/search.keyword-first.test.ts`
  — orchestrator-level test for the new branch.
- Modify: `apps/cms/src/api/search/services/search.ts` — in the
  `wantsVideos && mode === "keyword-first"` branch, push 4 retrievals
  (semantic + weighted-keyword + trigram + exact-title) onto the
  `retrievals[]` array. Reuse the existing `annotateVideo` helper.

**Approach:**

- All three new retrievers honor the same locale + `published_at`
  filtering as `searchByKeyword` (DISTINCT ON v.id, link-table joins,
  `bcp_47` filter). Copy the join chain verbatim; only the WHERE / rank
  expression differs.
- All three honor `OVERFETCH_FACTOR=3` via the orchestrator (already in
  place).
- `searchByKeywordWeighted`:
  - WHERE: `WEIGHTED_TSV_EXPR @@ websearch_to_tsquery('simple', ?)`
  - rank: `ts_rank_cd(WEIGHTED_TSV_EXPR, websearch_to_tsquery('simple', ?))`
  - Empty/whitespace input short-circuits to `[]` (mirror existing
    `searchByKeyword:115`).
- `searchByTrigram`:
  - WHERE: `videos.title %> ?` (the `%>` operator is `pg_trgm`'s
    "word similar to" — uses the GIN trigram index).
  - rank: `similarity(videos.title, ?)` DESC.
  - Empty input short-circuits.
- `searchByExactTitle`:
  - Tokenize the query by stripping punctuation and splitting on
    whitespace.
  - WHERE: `videos.title ILIKE '%' || $1 || '%'` AND `videos.title ILIKE
'%' || $2 || '%'` AND … (one ILIKE per token).
  - rank: `LENGTH(videos.title) ASC` (shorter title → tighter match).
  - 0 tokens or all-whitespace input → `[]`.
- In the orchestrator's keyword-first branch, push retrievals with labels
  `keyword-weighted-video`, `trigram-video`, `exact-title-video`. Existing
  `Promise.allSettled` / `unwrapOutcome` / empty-list filtering handles
  failures gracefully.

**Patterns to follow:**

- Locale + publish-state join chain from `keyword-search.ts:48-78`
  (DISTINCT ON, link tables, `bcp_47`, `LATERAL` image lookup, etc.).
- `mapRow` + `KeywordRow` type pattern.
- Empty-query short-circuit (`keyword-search.ts:115-117`).

**Test scenarios:**

- Per-retriever: each returns expected ordered IDs against a seeded
  fixture for `q="the Bible project"`.
- Trigram: `q="bibel project"` (typo) returns Bible Project videos
  (similarity > default threshold).
- Exact-title: `q="bible"` returns every title containing "bible";
  `q="the bible project"` returns only titles containing all three
  tokens.
- Locale: a Bible Project video published only in `es` does not appear
  for `locale="en"`.
- Empty / whitespace-only `q`: all three retrievers return `[]` without
  hitting the DB.
- Orchestrator: in keyword-first mode the fused list draws from 4
  ranked-list contributions for at least one query in the seed set;
  `searchMode` response field still reflects embedding success/failure
  only.
- Hybrid path: unchanged. Unit 2's regression snapshot still passes.

**Verification:**

- `EXPLAIN ANALYZE` on each new retriever's SQL shows `Bitmap Index Scan`
  on the appropriate index — never Seq Scan. Drift indicates byte-parity
  failure between bootstrap DDL and retriever SQL; the byte-equality
  unit test from Unit 1 should catch this earlier.
- All three new retriever modules export the same `(knex, params) =>
Promise<...>` signature shape so the orchestrator can `annotateVideo`
  uniformly.
- Regression snapshot from Unit 2 still passes byte-identically.

### Unit 4: Semantic-dilution cap + origin-gated `debug` field

**Goal:** Add the post-fusion semantic-dilution cap (flag-gated) and
expose per-retriever scores via `debug`, origin-gated.

**Requirements:** R3, R5

**Dependencies:** Unit 3.

**Files:**

- Modify: `apps/cms/src/api/search/services/search.ts` — insert cap step
  between `fuseRankedLists` and `deduplicateResults` in the keyword-first
  branch only; thread `debug` through the response.
- Modify: `apps/cms/src/api/search/services/fusion.ts` (if needed) —
  retain per-result list-of-origin trace so the cap can identify
  semantic-only contributions and so the debug payload can surface
  per-retriever scores. Keep changes additive (extra fields on
  `FusedResult`, no signature change).
- Modify: REST + GraphQL types — add optional `debug` to response shape
  (`debug: { retrieverScores, fusedScore, dilutionCapApplied }[]`,
  null when stripped). Update GraphQL typedef.
- Create: `apps/cms/src/api/search/services/search.dilution-cap.test.ts`
- Create: `apps/cms/src/api/search/services/search.debug.test.ts`

**Approach:**

- **Cap activation:**
  - Compute `topN_kw_core_ids` = union of `videoCoreId`s from the top-N
    (default 3) results of `keyword-weighted-video`, `trigram-video`,
    and `exact-title-video` lists.
  - The cap _triggers_ iff `exact-title-video` returned at least one
    result whose `videoTitle`, lowercased and whitespace-collapsed,
    contains every query token.
  - When triggered: any fused result that contributed _only_ via
    `semantic-video` AND whose `videoCoreId` is `null` or not in
    `topN_kw_core_ids` gets `score *= 0.5`. Re-sort.
- `SEARCH_DILUTION_CAP_ENABLED` defaults `true` in keyword-first; ignored
  on hybrid (cap step isn't reached). Read once at orchestrator entry
  (env reads in tight loops are wasteful).
- **`debug` gating:** reuse the existing CORS allowlist (read from the
  same source as the GraphQL plugin's CORS config). For REST: inspect
  `ctx.request.headers.origin`. For GraphQL: inspect
  `koaContext.request.headers.origin`. **Fail closed when `origin` is
  `undefined`** — strip the field. This protects against non-browser
  clients accidentally receiving internal scoring detail.
- `debug` payload shape per result: `{ retrieverScores: { semantic,
keywordWeighted, trigram, exactTitle }, fusedScore, dilutionCapApplied
}`. In hybrid mode the keyword-first-only score keys are absent (or
  null); `keyword` (legacy) and `semantic` are present.

**Patterns to follow:**

- Existing additive response field `searchMode` (feat-097 precedent).
- CORS origin handling — locate the existing allowlist before
  implementing; if it uses Yoga's pattern, apply the
  `yoga-cors-origin-undefined` learning (fail closed on `undefined`).

**Test scenarios:**

- Cap enabled + exact-title hit exists: a seeded semantic-only video with
  `core_id` outside the keyword top-N has `score *= 0.5`; one whose
  `core_id` is inside the top-N is not down-weighted; one with `core_id
=== null` is treated as outside (down-weighted).
- Cap enabled + no exact-title hit (e.g., `q="hope when life is hard"`):
  no down-weights; result order matches the no-cap output to within ±1
  position.
- `SEARCH_DILUTION_CAP_ENABLED=false`: no down-weights regardless.
- `debug=true` from an allowed origin (e.g., localhost): payload is
  present; `dilutionCapApplied` is `true` for the correct result(s).
- `debug=true` from a disallowed origin: payload stripped; the response
  shape is otherwise unchanged.
- `debug=true` from a request with `Origin: undefined`: payload
  stripped (fail closed).
- Default-mode (`mode` unset) regression snapshot still passes — the cap
  step is unreachable on the hybrid branch and the `debug` field is
  null (or absent) in the snapshot.

**Verification:**

- Behavior under the cap matches the test scenarios above.
- Debug payload presence is governed strictly by `(debug=true) AND
(origin in allowlist)`.
- No new `searchMode` values introduced.

### Unit 5: Headline acceptance test + cutover documentation

**Goal:** Lock in the user-facing acceptance criterion for keyword-first
mode and document the (out-of-scope-for-this-PR) cutover plan.

**Requirements:** R1–R5, R7

**Dependencies:** Unit 4.

**Files:**

- Create: `apps/cms/src/api/search/services/search.bible-project.test.ts`
- Modify (for PR description, manual at PR-open time): note the dilution-
  cap constants chosen, the `pg_size_pretty` output for the two new
  indexes, and a 24h passive canary diff between hybrid and keyword-first
  for a fixed query set before declaring stable.
- This plan doc — Cutover Plan section (below) is the cutover record;
  no separate cutover ticket is opened in this unit.

**Approach:**

- Seed fixtures (verbatim from the merged ticket):
  - 5 Bible Project video titles (e.g. "The Bible Project: Genesis 1-11",
    "The Bible Project: Exodus", etc.)
  - 3 unrelated videos with "project" in title or description
  - 3 unrelated videos with "bible" in description (not in title)
  - All published in `en`.
- Test calls `search()` with `q="the Bible project"`, `locale="en"`,
  `limit=10`, `mode="keyword-first"`.
- Assertions:
  - At least 8 of 10 result titles match `/bible\s*project/i`.
  - No result whose title lacks both "bible" AND "project" ranks above
    a result whose title contains both.
  - Top 3 results are all from the Bible Project seed set.
- Same query with `mode` unset returns the legacy diluted set (covered
  by Unit 2's regression snapshot — assert here too as a cross-check).
- Test must FAIL on `main` (no keyword-first mode exists) and PASS on
  this branch when `mode="keyword-first"` is passed. Verify by copying
  the test file onto a clone of `main` and running it; record the
  failure mode in the PR description.

**Patterns to follow:**

- Seeded-DB integration test pattern in
  `apps/cms/src/api/scene-embedding/services/recommender.test.ts` (or
  wherever existing search tests seed data).

**Test scenarios:**

- Headline assertion (above) passes on this branch.
- Headline assertion fails on `main` — verified by hand at PR-open time
  and recorded in the PR description.
- Same query without `mode` returns the legacy diluted set (cross-check
  with the regression snapshot).

**Verification:**

- Both gating tests (regression + acceptance) pass on this branch.
- Default behavior byte-identical to `main` for the regression query set.
- PR-B description records:
  - Final `SEARCH_DILUTION_CAP_ENABLED` default and down-weight
    constant.
  - Final top-N window for the cap trigger.
  - `pg_size_pretty(pg_total_relation_size())` output for both new
    GIN indexes.
  - 24h passive canary diff summary (hybrid vs keyword-first for a fixed
    query set in cms prod) before declaring stable.

## System-Wide Impact

- **Interaction graph:** `mode` is a strict additive arg. No callbacks,
  middleware, or observers change shape. Consumers that don't pass
  `mode` are not affected. The existing `searchMode` response field
  (degradation signal) is preserved verbatim.
- **Error propagation:** Unknown `mode` warns and falls back, never
  errors. Cap and `debug` failures (if any) are isolated to the
  keyword-first branch and the response-decoration tail; cannot affect
  hybrid responses. New retrievers are wrapped by the existing
  `Promise.allSettled` / `unwrapOutcome` envelope — a single retriever
  failing returns `[]` for that list rather than failing the whole
  response.
- **State lifecycle risks:** None. New generated columns derive from
  existing canonical fields (`title`, `description`). `pg_trgm` is
  idempotent and shared with no other code path. No write paths change.
  No backfill job needed (generated columns populate on the next
  insert/update; existing rows materialize on first read or via the
  `STORED` keyword in current Postgres versions, which compute on insert
  and on `ALTER TABLE` rewrite).
- **API surface parity:** `mode` and `debug` land on both REST
  (`GET /api/search`) and GraphQL (`Query.semanticSearch`). Both
  surfaces stay in lock-step through the orchestrator.
- **Integration coverage:** Unit 2's regression snapshot is the gate.
  Any unit-level pass that breaks it is a bug, not a feature. Unit 5's
  acceptance test exercises the full orchestrator under the new mode.
- **Affected stakeholders:**
  - **End users (no apps):** No change unless a consumer surface opts in.
  - **apps/web, apps/mobile, apps/tv:** Unchanged. Future opt-in lands
    via downstream cutover tickets.
  - **Operators:** Two new GIN indexes, one new extension, two new
    columns. Index size disclosed in PR-A description.
  - **`apps/admin` R4:** Mechanical follow-up port once Core-sync data
    model stabilizes; not blocked by this work.

## Risk Analysis & Mitigation

- **Risk: GIN byte-parity drift.** The weighted tsvector / trigram
  expressions in the migration must exactly match the expressions in
  Unit 3's retrievers, or the planner falls back to Seq Scan and
  keyword-first becomes 10–100× slower with no error. **Mitigation:**
  shared TS string constants in `lexical-sql.ts`; byte-equality unit
  test in Unit 1; `EXPLAIN ANALYZE` verification per retriever in Unit 3.
- **Risk: Snapshot test brittleness.** If the seeded DB or `main`'s
  current behavior changes between snapshot capture and PR-B merge, the
  regression test will spuriously fail. **Mitigation:** capture the
  snapshot against a deterministic, version-pinned seed checked into the
  repo; re-capture only with explicit reviewer approval; record the seed
  hash in the PR description.
- **Risk: `pg_trgm` extension not provisioned in dev / CI envs.**
  Bootstrap installs idempotently on app start, but bootstrap might be
  skipped in some test harnesses. **Mitigation:** confirm the test DB
  harness invokes bootstrap before tests run (verify during Unit 1).
  Bootstrap warns and continues if `CREATE EXTENSION` is denied (mirrors
  `ensurePgvector`'s posture).
- **Risk: Index growth.** Two new GIN indexes on a 955-row prod table
  are bounded but non-trivial. **Mitigation:** report
  `pg_size_pretty(pg_total_relation_size())` for both new indexes in
  PR-A's description. If size is alarming on cms prod, the trigram index
  is the most expendable (drop it; weighted GIN is the load-bearing one).
- **Risk: Naming collision (`mode` input vs `searchMode` output).**
  Future readers may conflate them. **Mitigation:** GraphQL typedef
  description on `mode` explicitly disambiguates; regression test
  asserts `searchMode` semantics are unchanged in either input mode.
- **Risk: `debug` field leaks internal scoring detail.** If origin
  gating fails open, scoring internals reach unauthorized clients.
  **Mitigation:** fail closed when `Origin: undefined` (yoga-cors
  learning); test for both allowed and disallowed origins; default to
  stripped unless allowlisted.
- **Risk: Generated-column rewrite cost on `ALTER TABLE`.** Adding
  `STORED` generated columns rewrites the table on most Postgres
  versions. On 955 rows this is sub-second but worth flagging.
  **Mitigation:** schedule the migration during off-peak deploy; the
  bootstrap module runs at app boot, so traffic is paused during the
  rewrite window; record the rewrite duration in PR-A description.
- **Risk: `experiences` keyword path silently piggybacks.** This work
  doesn't touch experiences, but a maintainer might later assume the
  weighted-tsvector pattern is symmetric. **Mitigation:** doc comment
  in the orchestrator explicitly notes experience retrievals are
  unchanged and the lexical stack applies to videos only this round.

## Documentation / Operational Notes

- After Unit 2 lands, `apps/cms/CLAUDE.md` should mention the new `mode`
  argument and the byte-identical-default invariant. Keep it short.
- After Unit 5 lands, `docs/roadmap/content-discovery/feat-109-search-keyword-first-mode.md`
  status flips from `not-started` → `complete`.
- PR-A description records:
  - `pg_size_pretty(pg_total_relation_size())` output for both new GIN
    indexes (cms prod).
  - `ALTER TABLE` rewrite duration on cms prod (from Railway logs).
  - Confirmation that `searchByKeyword`'s query plan is unchanged.
- PR-B description records:
  - Final `SEARCH_DILUTION_CAP_ENABLED` default and down-weight constant.
  - Final top-N window.
  - `mode="garbage"` warn-log shape captured from a real run.
  - 24h passive canary diff (hybrid vs keyword-first) before declaring
    stable.

### Cutover Plan (out of scope for this PR's implementation)

1. Ship PR-A (Unit 1) and PR-B (Units 2–5). Default `"hybrid"`;
   `"keyword-first"` opt-in.
2. Each consumer surface (`apps/web`, `apps/mobile`, `apps/tv`) opts in
   behind a client-side feature flag and soaks ≥2 weeks.
3. Compare zero-result rate, CTR@1, time-to-first-click, search
   abandonment per surface. Report in each surface's cutover ticket.
4. If metrics agree, flip the server-side default to `"keyword-first"`.
   Keep `"hybrid"` as an escape hatch indefinitely.
5. After ≥6 months as default `"keyword-first"`, consider deprecating
   hybrid mode (separate ticket). Drop `videos_fulltext_search_idx`
   after deprecation lands.

## Sources & References

- **Origin ticket:** `docs/roadmap/content-discovery/feat-109-search-keyword-first-mode.md`
- **Predecessor plan (this plan refines it):**
  `docs/plans/2026-04-28-001-feat-search-keyword-first-mode-plan.md`
- **Origin research report:** `docs/research/semantic-search-report.md`
  (§4 worked example, §6.1, §6.2, §7)
- Related code:
  - `apps/cms/src/api/search/services/search.ts`
  - `apps/cms/src/api/search/services/keyword-search.ts`
  - `apps/cms/src/api/search/services/semantic-search.ts`
  - `apps/cms/src/api/search/services/fusion.ts`
  - `apps/cms/src/api/search/controllers/search.ts`
  - `apps/cms/src/graphql/search.ts`
  - `apps/cms/src/bootstrap/ensure-pgvector.ts`
  - `apps/admin/src/services/hybrid-search-sql.ts` (R4 byte-parity ref)
- Related PRs: #848 (research report), #849 (predecessor plan + ticket),
  #780 (feat-097 — `searchMode` response field precedent).
- Institutional learnings: see Context & Research → Institutional Learnings.
- External docs: skipped — local R4 pattern is the canonical reference.
