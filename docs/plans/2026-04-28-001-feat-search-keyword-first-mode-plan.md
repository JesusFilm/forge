---
title: "feat(cms): search — opt-in keyword-first lexical mode"
type: feat
status: active
date: 2026-04-28
origin: docs/research/semantic-search-report.md
---

# feat(cms): search — opt-in keyword-first lexical mode

## Overview

Add an opt-in lexical mode to the existing `apps/cms` search API
(`Query.semanticSearch` GraphQL resolver + `GET /api/search` REST
handler). Reachable only when callers explicitly pass a new
`mode="keyword-first"` argument. Default behavior — and behavior for
every existing consumer (apps/web, apps/mobile, apps/tv) — stays
byte-identical to `main`.

The new mode closes the title-driven dilution gap reported by the
team: today `q="the Bible project"` returns a mix of Bible Project
videos and unrelated "project" videos because the keyword side is
bag-of-words, the tsvector lumps title + description together, and
the semantic side has no notion of phrases. Keyword-first mode adds
phrase-aware tsquery, per-field weighted tsvector, trigram-based
typo + prefix matching on title, an exact-title-match retriever as a
4th RRF list, and a semantic-dilution cap.

This is a strict extension of the existing pipeline, per
`docs/research/semantic-search-report.md` §6.2 ("API shape —
backwards-compatible additions") and §7 ("Extend, Don't Fork"). No
parallel pipeline, no default-behavior replacement, no new sibling
resolver.

Ships to `apps/cms` first. Admin R4 port is a mechanical follow-up
once the upstream Core-sync data-model reshape lands and admin's
`Video`/`VideoEdition` rows exist in prod.

## Problem Frame

Three behaviors in the current orchestrator dilute title-driven
queries:

- `plainto_tsquery('simple', q)` flattens the query to `term1 & term2
& …`. Phrase adjacency is lost.
- The keyword tsvector is `to_tsvector('simple', title || ' ' ||
description)` — title and description hits weigh equally.
- pgvector cosine has no notion of phrases. For `"the Bible project"`
  it surfaces videos thematically near "bible" + "ministry" +
  "project," not just The Bible Project series. RRF then fuses the
  diluted lists and the tail leaks into the top results.

Algolia handles this with phrase proximity, per-field attribute
weighting (title ≫ description), typo-tolerant prefix matching, and
a strong bias toward results where every query token appears in the
most-important attribute.

The team's research report concluded these improvements should land
as nullable additions on the existing resolver, preserving the
default contract for every current consumer. (see origin:
`docs/research/semantic-search-report.md` §6.2, §7)

## Requirements Trace

- **R1.** Add a nullable `mode` argument (REST query param + GraphQL
  nullable `String` arg) accepting `"hybrid"` (current behavior) and
  `"keyword-first"` (new lexical stack). Unknown values fall back to
  hybrid with a structured warning log; never error.
- **R2.** Default behavior is byte-identical to `main`. When `mode`
  is unset or `"hybrid"`, response (id list + ranking + scores)
  matches `main` exactly for a fixed regression query set. Locked in
  by a snapshot test that runs throughout the PR.
- **R3.** `mode="keyword-first"` activates the new lexical stack:
  phrase-aware tsquery (`websearch_to_tsquery`), weighted per-field
  tsvector (`title_tsv` weight A, `description_tsv` weight B),
  trigram-based typo + prefix tolerance on title, exact-phrase-in-title
  retriever as a 4th RRF list, and a semantic-dilution cap.
- **R4.** DB-level changes (`pg_trgm` extension, weighted generated
  columns, GIN indexes) are infrastructure both modes can sit on.
  The default-mode SQL path continues to use `plainto_tsquery` plus
  the legacy concatenated tsvector exactly as today — the new
  columns are dormant on that path.
- **R5.** Optional `debug=true` query param (origin-gated to
  localhost / staging) exposes per-retriever scores in either mode.
- **R6.** Strapi-first ship. `apps/admin` R4 port is a separate
  follow-up ticket once the Core-sync data-model reshape lands.
- **R7.** Cutover (flipping the default to `"keyword-first"`) is
  documented but not executed in this PR. A separate cutover ticket
  flips the default after each consumer surface (web, mobile, tv)
  opts in and soaks ≥2 weeks.

## Scope Boundaries

**In scope:**

- `mode` argument plumbed through REST handler, GraphQL resolver,
  and `search()` orchestrator. Default `"hybrid"`.
- Bootstrap migration: `pg_trgm` extension; generated `title_tsv`
  (weight A) + `description_tsv` (weight B) columns; weighted GIN
  index on `setweight(title_tsv, 'A') || setweight(description_tsv,
'B')`; GIN trigram index on `videos.title`.
- New keyword-first keyword retriever using `websearch_to_tsquery`
  against the weighted tsvector.
- New `searchVideoTrigram` retriever (3rd RRF list) and
  `searchVideoExactTitle` retriever (4th RRF list), active only in
  keyword-first mode.
- Semantic-dilution cap behind `SEARCH_DILUTION_CAP_ENABLED`
  (default on for keyword-first, no-op for hybrid).
- Origin-gated `debug=true` response field exposing per-retriever
  scores. Available in both modes.
- Default-mode regression test (gating).
- Keyword-first acceptance test for `q="the Bible project"`
  (gating).
- Cutover plan documented in this plan; cutover itself out-of-scope
  for the implementation PR.

**Out of scope (deferred to follow-ups):**

- Flipping the default from `"hybrid"` to `"keyword-first"`.
- Synonyms / stopwords / brand dictionaries.
- Persona / demographic facets and ranking.
- Multilingual query handling (per-locale embedding model, locale-
  specific tokenization).
- Click-through telemetry (`search_queries` log, `recordSearchClick`).
- `mode="instant"` latency-tradeoff variant from §6.2 of the report.
- `apps/admin` R4 port.

## Context & Research

### Relevant Code and Patterns

- `apps/cms/src/api/search/services/search.ts` — current
  orchestrator. RRF + dedup pipeline lives here. `mode` plumbing
  and the keyword-first branch hook in here.
- `apps/cms/src/api/search/services/retrievers.ts` (or equivalent
  per-retriever module) — current `searchVideoSemantic` +
  `searchVideoKeyword` helpers. New retrievers land alongside; the
  existing ones stay untouched (legacy hybrid mode keeps using them
  as-is).
- `apps/cms/src/api/search/services/fusion.ts` — RRF constants
  (`RRF_K = 60`, `OVERFETCH_FACTOR = 3`). Already accepts
  `Array<Array<…>>` so adding ranked lists for keyword-first mode
  is a no-op to the merge.
- `apps/cms/src/bootstrap/ensure-pgvector.ts` — pattern for
  idempotent `CREATE EXTENSION` + `CREATE INDEX IF NOT EXISTS`. The
  new bootstrap module mirrors this shape.
- `apps/cms/src/api/scene-embedding/services/recommender.ts` —
  reference for `core_id` joins and 3-layer dedup; semantic-dilution
  cap reuses the `core_id` overlap check.
- `apps/admin/src/services/hybrid-search-sql.ts` — R4 pattern: GIN
  byte-parity invariant via shared TypeScript constant + migration
  byte-equality assertion test. Replicate on the cms side.

### Institutional Learnings

- **Strapi v5 raw SQL: snake-cased columns.** Verify with `\d
videos` against a real DB before writing the migration. Do not
  assume camelCase.
- **PostgreSQL 18 (Railway): `?::jsonb::text[]` cast unsupported.**
  Use PG array literal format (`{val1,val2}`) with `?::text[]` if
  any array casts come up.
- **GIN byte-parity invariant.** Any tsvector expression used in a
  query MUST exactly match the indexed expression, or the planner
  silently falls back to Seq Scan. Lift the expression into a
  shared TS constant; assert byte-equality with the migration in a
  unit test. Drift here is the #1 reason for silent perf regressions.
- **Generated columns over triggers** for derived tsvector. No
  trigger lifecycle; index built once. Trade-off: changing the
  expression later requires `DROP COLUMN … CASCADE`. Acceptable for
  this one-shot upgrade.
- **`pg_trgm` extension is idempotent.** Mirror
  `ensure-pgvector.ts`'s `CREATE EXTENSION IF NOT EXISTS …` shape;
  safe across redeploys.

### External References

Skipped — Postgres `pg_trgm`, `websearch_to_tsquery`, weighted
tsvector, and RRF are well-established primitives with strong local
reference patterns (apps/admin R4) that we should mirror for
consistency.

## Key Technical Decisions

- **Opt-in via `mode` argument; default behavior byte-identical.**
  Per the origin report (§6.2, §7) and the user's explicit
  requirement. Existing consumers must NOT see any change in
  ranking unless they opt in. Locked in by a regression test that
  asserts byte-identical results vs `main` for a fixed query set.

- **`mode` is a nullable String, not a closed enum.** Accepts
  `"hybrid"` (default) and `"keyword-first"`. String over enum so
  future modes (`"instant"`, `"persona-aware"`) can ship as new
  values without a schema change. Unknown values warn-and-fallback
  to hybrid; a typoed param never breaks a user's search.

- **DB infrastructure shared, code paths separated.** The migration
  installs `pg_trgm`, `title_tsv`, `description_tsv`, and the new
  GIN indexes — but they are dormant when `mode="hybrid"`. The
  default keyword path continues to read the legacy concatenated
  tsvector and runs `plainto_tsquery` exactly as today. Slight
  schema cost (unused indexed columns when no consumer opts in) in
  exchange for a hard guarantee that the default path is untouched.

- **`websearch_to_tsquery` over `phraseto_tsquery`.** Both preserve
  phrase adjacency; `websearch_to_tsquery` additionally accepts
  user-typed double-quotes as exact phrases (more Algolia-like) and
  degrades gracefully on unquoted input.

- **Trigram index on `videos.title` only, not description.**
  Description is long, low-signal for typo/prefix matching, and
  would balloon index size. Title trigram captures the Bible
  Project case without bloat.

- **Exact-phrase-in-title boost as a discrete RRF list, not a score
  multiplier.** RRF already accepts N lists; adding a 4th keeps the
  fusion pipeline uniform. A multiplier path couples ranking logic
  to the fusion step and is harder to reason about.

- **Semantic-dilution cap as a soft 0.5× down-weight, not a hard
  filter.** Hard filtering breaks the long tail for thematic
  queries. The down-weight kicks in only when an exact-title match
  exists in the top keyword results, preserving semantic results
  in their natural domain. Behind `SEARCH_DILUTION_CAP_ENABLED`
  env flag so it can be disabled at runtime without redeploy.

- **`debug=true` is dev-only.** Strip from the response shape
  unless the request originates from a localhost or staging origin
  (gate via existing CORS/origin check). Avoids leaking internal
  scoring detail to consumers.

- **Test-first sequencing for `mode` plumbing.** The default-mode
  regression test lands BEFORE any keyword-first retriever code,
  so the byte-identical guarantee is enforced from the first line
  of behavior change onward.

## Open Questions

### Resolved During Planning

- **Default-replace vs opt-in?** Opt-in. Per `docs/research/semantic-
search-report.md` §6.2, §7 and the user's explicit requirement.
- **Where does this ship — cms or admin?** cms first. Admin R4 port
  is a mechanical follow-up once the Core-sync data-model reshape
  stabilizes.
- **Multiplier vs ranked-list for exact-title boost?** Ranked list.
  Keeps the fusion pipeline uniform.
- **`pg_trgm` extension scope?** Title only. Description trigram
  would bloat the index without meaningful improvement.

### Deferred to Implementation

- **Final down-weight constant for the semantic-dilution cap.**
  Starts at 0.5× as a directional default; tune against the
  acceptance test and a small canary set during implementation.
  Report the chosen value in the PR description.
- **Exact column names for generated tsvector columns.** Plan calls
  them `title_tsv` and `description_tsv` directionally; final names
  resolved against existing `videos` table conventions when
  inspecting `\d videos`.
- **`websearch_to_tsquery` empty-input short-circuit.** Need to
  confirm the orchestrator already short-circuits on whitespace-
  only queries before reaching the retriever. If not, add a guard
  in keyword-first mode to avoid an unindexed scan on an empty
  tsquery. Inspect during implementation.
- **Whether the GIN byte-parity test should live as a unit test in
  the search module or as a migration-side test.** Local R4 pattern
  (`apps/admin/src/services/hybrid-search-sql.ts`) places it in the
  service module; mirror that.

## High-Level Technical Design

> *This illustrates the intended approach and is directional
> guidance for review, not implementation specification. The
> implementing agent should treat it as context, not code to
> reproduce.*

The orchestrator branches on `mode` exactly once. Hybrid mode is the
existing pipeline, untouched. Keyword-first mode adds two new
retrievers, swaps the keyword retriever for a weighted/phrase-aware
variant, and inserts a semantic-dilution-cap step between fusion
and dedup.

```
search(q, locale, mode, limit, offset, debug?)
  │
  ├── normalize mode: unset|"hybrid" → hybrid; "keyword-first" → tp
  │   any other value → log warn, fallback to hybrid
  │
  ├── if mode == hybrid:                            ← UNCHANGED FROM main
  │     embed(q)
  │     parallel:
  │       L1 = searchVideoSemantic(q_emb, locale)
  │       L2 = searchVideoKeyword(plainto, concat-tsvector, locale)
  │     fuse(L1, L2)  via RRF (k=60, 2 lists)
  │     dedup (core_id prefix, exact title, embedding>0.95)
  │     paginate(limit, offset)
  │     [if debug allowed] attach per-retriever scores
  │     return
  │
  └── if mode == keyword-first:                    ← NEW PATH
        embed(q)
        parallel:
          L1 = searchVideoSemantic(q_emb, locale)
          L2 = searchVideoKeywordWeighted(
                 websearch_to_tsquery(q),
                 setweight(title_tsv,'A')||setweight(desc_tsv,'B'),
                 locale)
          L3 = searchVideoTrigram(q, videos.title GIN-trgm, locale)
          L4 = searchVideoExactTitle(q tokens, locale)
        fuse(L1, L2, L3, L4)  via RRF (k=60, 4 lists)
        if SEARCH_DILUTION_CAP_ENABLED and L4 has top hit:
          for each result in fused:
            if result.list_origin == semantic-only and
               result.core_id ∉ {top-N keyword/trigram/exact core_ids}:
              result.score *= 0.5
          re-sort
        dedup (same 3 layers)
        paginate(limit, offset)
        [if debug allowed] attach per-retriever scores
        return
```

The hybrid branch has no new dependencies and reads no new columns.
The two paths share `embed()`, `fuse()`, dedup, and pagination — but
the keyword expression and the count of fusion lists differ, so a
single shared retriever wouldn't have been correct.

## Implementation Units

- [ ] **Unit 1: Bootstrap migration — `pg_trgm`, weighted tsvector
  columns, GIN indexes**

  **Goal:** Provision the DB infrastructure both modes can sit on.
  Idempotent, populated regardless of mode, dormant when
  `mode="hybrid"`.

  **Requirements:** R3, R4

  **Dependencies:** None.

  **Files:**
  - Create: `apps/cms/src/bootstrap/ensure-search-lexical.ts`
  - Modify: `apps/cms/src/bootstrap/index.ts` (or wherever
    `ensure-pgvector` is wired) to invoke the new module on boot
  - Test: `apps/cms/src/bootstrap/ensure-search-lexical.test.ts`

  **Approach:**
  - Mirror `ensure-pgvector.ts`'s shape: idempotent `CREATE
EXTENSION IF NOT EXISTS pg_trgm`, then `ALTER TABLE videos ADD
COLUMN IF NOT EXISTS title_tsv tsvector GENERATED ALWAYS AS
(to_tsvector('simple', coalesce(title, ''))) STORED`, same
    for `description_tsv`, then `CREATE INDEX IF NOT EXISTS …` for
    the weighted GIN and the trigram GIN.
  - Lift the weighted tsvector expression and the trigram expression
    into shared TS string constants exported from the bootstrap
    module so the keyword-first retriever (Unit 3) can reuse them
    byte-identically.
  - The GIN byte-parity test (loaded fixtures or string compare)
    asserts the exported TS constant matches the SQL emitted by
    bootstrap.

  **Patterns to follow:**
  - `apps/cms/src/bootstrap/ensure-pgvector.ts`
  - `apps/admin/src/services/hybrid-search-sql.ts` (byte-parity
    assertion shape)

  **Test scenarios:**
  - Bootstrap is safe to run twice in a row against the same DB
    (idempotency).
  - The exported TS constants for the weighted tsvector and trigram
    expressions match the SQL the migration emits, byte-for-byte.
  - After bootstrap, `\d videos` includes `title_tsv`,
    `description_tsv`, and the two new GIN indexes.
  - `EXPLAIN ANALYZE SELECT * FROM videos WHERE title %> 'bible
project'` shows `Bitmap Index Scan` on the trigram index.

  **Verification:**
  - All three new objects (`pg_trgm` extension, both generated
    columns, both GIN indexes) exist after deploy.
  - No Seq Scan in the EXPLAIN output for either index's intended
    query shape.

- [ ] **Unit 2: `mode` argument plumbing + default-mode regression
  test (test-first)**

  **Goal:** Plumb the `mode` argument from REST + GraphQL through
  `search()`, with hybrid as the default. Lock in byte-identical
  default behavior with a snapshot test that runs from this point
  forward.

  **Requirements:** R1, R2

  **Dependencies:** Unit 1 (so the migration is in place; not
  strictly required for this unit's behavior but keeps the branch
  buildable end-to-end).

  **Files:**
  - Modify: REST handler in `apps/cms/src/api/search/controllers/`
    (or equivalent) — accept `mode` query param.
  - Modify: GraphQL resolver in `apps/cms/src/graphql/search.ts` (or
    wherever `Query.semanticSearch` is defined) — accept nullable
    `String` arg.
  - Modify: `apps/cms/src/api/search/services/search.ts` —
    orchestrator accepts `mode`; in this unit only the hybrid branch
    is reachable, but the parameter and the warn-and-fallback for
    unknown values are wired through.
  - Test: `apps/cms/src/api/search/services/search.regression.test.ts`
    (new — snapshot of fixed query set; asserts byte-identical
    response to `main` when `mode` is unset or `"hybrid"`).
  - Test: `apps/cms/src/api/search/services/search.test.ts` —
    extend with cases covering `mode` arg parsing, unknown-value
    fallback, structured warn log emission.

  **Execution note:** Test-first. Land the regression snapshot
  against `main`'s current behavior (with `mode` unwired) BEFORE
  introducing the `mode` parameter, so the snapshot represents the
  pre-change baseline. The snapshot test then continues to pass as
  `mode` plumbing lands and through every subsequent unit.

  **Approach:**
  - Default `"hybrid"` when arg is unset or null.
  - Unknown values: log structured warning (`event=search_unknown_mode
mode=… falling_back=hybrid`) and proceed as hybrid. Never error.
  - Regression query set:
    - `q="the Bible project"`, `locale="en"`, `limit=10`
    - `q="forgiveness"`, `locale="en"`, `limit=10`
    - `q="easter"`, `locale="en"`, `limit=10`
    - `q="resurrection"`, `locale="es"`, `limit=10`
    - `q="  "` (whitespace) — current error/empty behavior preserved
  - Seed the test DB deterministically so snapshots are stable.

  **Patterns to follow:**
  - Existing REST query-param parsing in `apps/cms/src/api/search/
controllers/`
  - Existing nullable-arg patterns in
    `apps/cms/src/graphql/recommendations.ts` and adjacent resolvers

  **Test scenarios:**
  - `mode` unset → identical response to `main`.
  - `mode="hybrid"` → identical response to `main`.
  - `mode="garbage"` → identical response to `main` + warning log
    captured.
  - REST: `?mode=keyword-first` parsed and passed through (returns
    hybrid behavior in this unit; keyword-first branch lands in
    Unit 3).
  - GraphQL: nullable `String` accepted; null/missing → hybrid.

  **Verification:**
  - Regression snapshot test passes on this branch against the same
    seeded DB used to capture from `main`.
  - Warning log emitted exactly once per unknown-mode call,
    structured.

- [ ] **Unit 3: Keyword-first retrievers + RRF wiring**

  **Goal:** Implement the keyword-first branch of the orchestrator —
  the weighted/phrase-aware keyword retriever, the trigram retriever,
  and the exact-title retriever — and wire them into RRF as a 4-list
  fusion. Hybrid path remains untouched.

  **Requirements:** R3, R4

  **Dependencies:** Unit 1 (DB infra), Unit 2 (`mode` plumbing).

  **Files:**
  - Modify: `apps/cms/src/api/search/services/retrievers.ts` (or
    create per-retriever sibling files) — add
    `searchVideoKeywordWeighted`, `searchVideoTrigram`,
    `searchVideoExactTitle`. Existing `searchVideoKeyword` and
    `searchVideoSemantic` untouched.
  - Modify: `apps/cms/src/api/search/services/search.ts` — in the
    keyword-first branch, call all four retrievers in parallel and
    pass to `fuseRankedLists`.
  - Test: `apps/cms/src/api/search/services/retrievers.test.ts` —
    extend with per-retriever unit tests against the seeded DB.
  - Test: `apps/cms/src/api/search/services/search.keyword-first.test.ts`
    (new) — orchestrator-level test for the keyword-first branch.

  **Approach:**
  - `searchVideoKeywordWeighted`: `websearch_to_tsquery('simple',
$1) @@ (setweight(title_tsv, 'A') || setweight(description_tsv,
'B'))`. Order by `ts_rank_cd` of the weighted vector. Locale +
    publish-state filtering identical to the current keyword
    retriever.
  - `searchVideoTrigram`: `videos.title %> $1` (or `similarity()`
    threshold) using the GIN trigram index. Locale + publish-state
    filtering identical.
  - `searchVideoExactTitle`: tokenize the query (whitespace +
    punctuation strip), require every token present in `title`
    case-insensitive (`videos.title ILIKE ALL (ARRAY[$1, $2, ...])`
    or equivalent). Returns 0 or more rows ranked by title length
    ascending (shorter titles → tighter match → higher rank).
  - All retrievers honor `OVERFETCH_FACTOR=3 * limit`.
  - Fusion call site: in keyword-first branch, pass all four
    ranked lists to existing `fuseRankedLists` — no fusion-logic
    change.

  **Patterns to follow:**
  - Locale + publish-state join chain from existing
    `searchVideoKeyword` (`apps/cms/src/api/search/services/
retrievers.ts`).
  - `core_id` resolution from
    `apps/cms/src/api/scene-embedding/services/recommender.ts`.

  **Test scenarios:**
  - `q="the Bible project"`, keyword-first mode: each retriever
    individually returns expected ordered IDs against the seeded
    fixture.
  - `q="bibel project"` (typo): trigram retriever returns Bible
    Project videos; weighted keyword may return zero. Fusion still
    surfaces them.
  - `q="bible"` (single token): exact-title retriever returns all
    titles containing "bible" (since the only token is present).
  - Locale filtering honored across all four retrievers.
  - Default-mode regression test from Unit 2 still passes.

  **Verification:**
  - `EXPLAIN ANALYZE` on each new retriever shows `Bitmap Index
Scan` on the appropriate index. No Seq Scan.
  - Keyword-first orchestrator returns 4 ranked lists' worth of
    fused output for queries with at least one keyword hit.
  - Hybrid path response is byte-identical to Unit 2's snapshot.

- [ ] **Unit 4: Semantic-dilution cap (flag-gated) + `debug=true`
  surfacing**

  **Goal:** Add the post-fusion semantic-dilution cap behind
  `SEARCH_DILUTION_CAP_ENABLED`, and surface per-retriever scores
  via `debug=true` (origin-gated).

  **Requirements:** R3, R5

  **Dependencies:** Unit 3.

  **Files:**
  - Modify: `apps/cms/src/api/search/services/search.ts` — insert
    cap step between `fuseRankedLists` and `deduplicateResults` in
    the keyword-first branch only; add `debug` plumbing.
  - Modify: `apps/cms/src/api/search/services/fusion.ts` (if needed)
    — extend the per-result trace shape to retain list-origin info
    for the cap and the debug surface.
  - Modify: REST + GraphQL types — add optional `debug` payload to
    response.
  - Test: `apps/cms/src/api/search/services/search.dilution-cap.test.ts`
    (new) — covers the cap on/off and the trigger condition.
  - Test: `apps/cms/src/api/search/services/search.debug.test.ts`
    (new) — covers origin-gated debug field.

  **Approach:**
  - Cap activation: a top-N (start: top-3) result from any of the
    keyword / trigram / exact-title retrievers must have a title
    that contains every query token (case-insensitive). If yes, any
    fused result whose contributing lists are semantic-only AND
    whose `core_id` is not in the keyword-side top-N's `core_id`
    set gets `score *= 0.5`. Re-sort.
  - `SEARCH_DILUTION_CAP_ENABLED` defaults to `true` in
    keyword-first and is a no-op in hybrid (the cap step isn't
    reached on the hybrid branch).
  - `debug=true`: only attached to the response when the request's
    Origin header is in the configured dev/staging allowlist
    (reuse existing CORS allowlist). For unauthorized origins,
    silently strip the field.
  - `debug` payload shape: `{ retrieverScores: { semantic: …,
keyword: …, trigram: …, exactTitle: … }, fusedScore: …,
dilutionCapApplied: boolean }` per result.

  **Patterns to follow:**
  - Existing `searchMode` field on the response (added by
    feat-097) for additive non-breaking response fields.
  - CORS/origin gating already in place for `/api/search`.

  **Test scenarios:**
  - Cap enabled + exact-title hit exists: semantic-only results
    sharing no `core_id` with top-N keyword hits are
    down-weighted; results sharing `core_id` are not.
  - Cap enabled + no exact-title hit (e.g., `q="hope when life is
hard"`): cap does NOT trigger; ranking matches no-cap output
    within ±1 position.
  - `SEARCH_DILUTION_CAP_ENABLED=false`: cap step is a no-op.
  - `debug=true` from allowed origin: payload present.
  - `debug=true` from disallowed origin: payload stripped.
  - Default-mode regression test still passes.

  **Verification:**
  - Behavior under the cap matches the test scenarios above.
  - Debug payload is present iff origin allowed AND `debug=true`.

- [ ] **Unit 5: Keyword-first acceptance test + cutover plan
  documentation**

  **Goal:** Lock in the user-facing acceptance criterion for
  keyword-first mode and document the (out-of-scope-for-this-PR)
  cutover plan for future work.

  **Requirements:** R1–R5, R7

  **Dependencies:** Unit 4.

  **Files:**
  - Test: `apps/cms/src/api/search/services/search.bible-project.test.ts`
    (new) — headline acceptance test.
  - Modify: PR description (manual, at PR-open time) — note the
    24h passive canary diff between hybrid and keyword-first before
    declaring stable.
  - This plan doc — Cutover Plan section already documents the
    sequence; no separate cutover ticket is opened in this unit.

  **Approach:**
  - Seed test DB with: 5 real Bible Project video titles, 3
    unrelated videos with "project" in title or description, 3
    unrelated videos with "bible" in description but not title.
  - Acceptance test calls the orchestrator with `q="the Bible
project"`, `locale="en"`, `limit=10`, `mode="keyword-first"`.
  - Asserts:
    - At least 8 of the top 10 results have a `title` matching
      `/bible\s*project/i`
    - No result whose title does NOT contain both "bible" AND
      "project" ranks above any result whose title DOES contain
      both
    - Top 3 results are all Bible Project videos
  - Same query with `mode` unset must continue to return the legacy
    diluted set (covered by Unit 2's regression snapshot).

  **Patterns to follow:**
  - Seeded-DB integration tests in `apps/cms/src/api/search/
__tests__/` if any exist; otherwise mirror the pattern from
    `apps/cms/src/api/scene-embedding/services/recommender.test.ts`.

  **Test scenarios:**
  - Headline assertion (above) passes on this branch.
  - Headline assertion fails on `main` (no keyword-first mode
    exists yet) — verified by running the test against a clone of
    `main` with the new test file copied in.
  - Cutover-plan section in this plan doc references the future
    cutover ticket (to be filed separately).

  **Verification:**
  - All gating tests (regression + acceptance) pass on this branch.
  - Default behavior still byte-identical to `main` for the
    regression query set.
  - PR description records the chosen `SEARCH_DILUTION_CAP_ENABLED`
    default and the dilution-cap down-weight constant.

## System-Wide Impact

- **Interaction graph:** `mode` is a strict additive arg. No
  callbacks, middleware, or observers change shape. Consumers that
  don't pass `mode` are not affected.
- **Error propagation:** Unknown `mode` values warn and fall back —
  never error. Cap and debug failures (if any) are isolated to the
  keyword-first branch and cannot affect hybrid responses.
- **State lifecycle risks:** None — the new generated columns are
  derived from existing canonical fields (`title`, `description`).
  The `pg_trgm` extension is idempotent and shared with no other
  code path. No write paths change.
- **API surface parity:** `mode` and the optional `debug` field land
  on both REST (`GET /api/search`) and GraphQL
  (`Query.semanticSearch`). The two surfaces stay in lock-step
  through the orchestrator (single source of truth).
- **Integration coverage:** The default-mode regression test
  (Unit 2) is the gate — any unit-level pass that breaks it is a
  bug, not a feature. The keyword-first acceptance test (Unit 5)
  exercises the full orchestrator under the new mode.

## Risks & Dependencies

- **Risk: GIN byte-parity drift.** The weighted tsvector expression
  in the migration must exactly match the expression in
  `searchVideoKeywordWeighted`, or the planner falls back to Seq
  Scan. Mitigation: shared TS constant + byte-equality test in
  Unit 1, mirroring the R4 admin pattern.
- **Risk: Snapshot test brittleness.** If the seeded DB or the
  current behavior of `main` changes between snapshot capture and
  PR merge, the regression test will spuriously fail. Mitigation:
  capture snapshots against a deterministic, version-pinned seed;
  re-capture only with explicit reviewer approval.
- **Risk: `pg_trgm` extension not provisioned in dev / CI envs.**
  Bootstrap installs it idempotently on app start; verify the test
  DB harness invokes bootstrap before tests run.
- **Risk: Index growth.** Two new GIN indexes on
  `videos`. Title trigram and weighted tsvector are bounded but
  non-trivial. Report `pg_size_pretty(pg_total_relation_size(…))`
  in the PR description.
- **Dependency: Existing CORS/origin allowlist** must already gate
  `debug` to localhost / staging. Verify before relying on it for
  Unit 4.

## Documentation / Operational Notes

- `apps/cms/CLAUDE.md` should mention the new `mode` argument and
  the byte-identical-default invariant once Unit 2 lands.
- The PR description should record:
  - Final `SEARCH_DILUTION_CAP_ENABLED` default in keyword-first.
  - Final dilution-cap down-weight constant (start 0.5×).
  - `pg_size_pretty` output for both new indexes.
  - 24h passive canary diff summary (hybrid vs keyword-first for a
    fixed query set) before declaring stable.
- Cutover plan (out of scope for this PR's implementation):
  1. Ship this PR. Default `"hybrid"`; `"keyword-first"` opt-in.
  2. Each consumer surface (web, mobile, tv) opts in via a
     client-side feature flag and soaks ≥2 weeks.
  3. Compare zero-result rate, CTR@1, time-to-first-click, search
     abandonment per surface. Report in each surface's cutover
     ticket.
  4. If metrics agree, flip server-side default to
     `"keyword-first"`. Keep `"hybrid"` as an escape hatch
     indefinitely.
  5. After ≥6 months as default `"keyword-first"`, consider
     deprecating hybrid mode (separate ticket).

## Sources & References

- **Origin document:** `docs/research/semantic-search-report.md`
  (merged via PR #848)
- Related code:
  - `apps/cms/src/api/search/services/search.ts`
  - `apps/cms/src/api/search/services/retrievers.ts`
  - `apps/cms/src/api/search/services/fusion.ts`
  - `apps/cms/src/bootstrap/ensure-pgvector.ts`
  - `apps/admin/src/services/hybrid-search-sql.ts` (R4 byte-parity
    pattern)
- Related PRs: #848 (origin report), #780 (feat-097 silent embedding
  failure surfacing — `searchMode` field is the precedent for
  additive response fields).
- External docs: skipped — local R4 pattern is the canonical
  reference for GIN byte-parity and weighted tsvector usage.
