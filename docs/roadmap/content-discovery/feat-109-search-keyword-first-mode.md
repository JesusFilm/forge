---
id: "feat-109"
title: "Search — opt-in keyword-first lexical mode"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-04-28"
duration: 3
depends_on: []
blocks:
  - "feat-172"
tags:
  - "cms"
  - "search"
---

## Problem

Title-driven queries leak. `q="the Bible project"` today returns a
mix of Bible Project videos and unrelated "project" videos —
`plainto_tsquery` flattens phrases into `term & term`, the keyword
tsvector lumps title + description into one bag-of-words, and the
semantic side has no notion of phrases so it dilutes the tail.
Algolia handles this with phrase proximity, per-field weighting, and
typo-tolerant prefix matching.

The team's research report (`docs/research/semantic-search-report.md`,
§6.2 + §7) explicitly framed the fix as **nullable additions on the
existing `Query.semanticSearch` resolver** — not a default-behavior
replacement. This ticket implements that framing: a new opt-in
`mode="keyword-first"` exposes the new lexical stack while every
existing consumer (apps/web, apps/mobile, apps/tv) keeps receiving
byte-identical results to today.

## Plan

Full plan with implementation units, technical decisions, gating
tests, and cutover plan:
`docs/plans/2026-04-28-001-feat-search-keyword-first-mode-plan.md`

## What To Build

Opt-in only. Default behavior must stay byte-identical to `main`.

- [ ] **Unit 1.** `pg_trgm` extension + generated `title_tsv`
      (weight A) + `description_tsv` (weight B) columns + weighted
      GIN index + GIN trigram index on `videos.title`. Idempotent
      bootstrap. Indexes populate regardless of mode.
- [ ] **Unit 2.** `mode` arg plumbed through REST + GraphQL +
      orchestrator. Default `"hybrid"`. Unknown values warn-and-
      fallback (never error). **Default-mode regression test
      lands first** as a snapshot of `main`'s current behavior;
      must continue to pass through every subsequent unit.
- [ ] **Unit 3.** Keyword-first retrievers — `searchVideoKeywordWeighted`
      (`websearch_to_tsquery` + weighted tsvector),
      `searchVideoTrigram`, `searchVideoExactTitle` — wired into RRF
      as a 4-list fusion in the keyword-first branch only. Hybrid
      branch stays untouched.
- [ ] **Unit 4.** Semantic-dilution cap behind
      `SEARCH_DILUTION_CAP_ENABLED` (0.5× down-weight on
      semantic-only results that share no `core_id` with any
      keyword-side top-N hit, when an exact-title match exists).
      Origin-gated `debug=true` response field surfaces per-retriever
      scores in either mode.
- [ ] **Unit 5.** Keyword-first acceptance test (Bible Project
      headline). Cutover plan documented in plan doc.

## Entry Points — Read These First

1. `apps/cms/src/api/search/services/search.ts` — orchestrator;
   `mode` plumbing and the keyword-first branch hook in here.
2. `apps/cms/src/api/search/services/retrievers.ts` — current
   `searchVideoSemantic` + `searchVideoKeyword`. New retrievers land
   alongside; existing ones stay untouched.
3. `apps/cms/src/api/search/services/fusion.ts` — RRF (`RRF_K=60`,
   `OVERFETCH_FACTOR=3`); already accepts N ranked lists.
4. `apps/cms/src/bootstrap/ensure-pgvector.ts` — pattern for
   idempotent `CREATE EXTENSION` + `CREATE INDEX IF NOT EXISTS`.
   Mirror in the new bootstrap module.
5. `apps/admin/src/services/hybrid-search-sql.ts` — R4 GIN
   byte-parity pattern (TS constant + migration byte-equality test).
   Replicate.
6. `docs/research/semantic-search-report.md` §6.2, §7 — origin
   framing for "nullable additions on the existing resolver."

## Grep These

- `plainto_tsquery` — current default keyword path; **must stay
  unchanged** in hybrid mode. New `websearch_to_tsquery` is reached
  only via the keyword-first branch.
- `to_tsvector('simple', title || ' ' || description)` — current
  default tsvector expression; stays untouched on the hybrid path.
- `RRF_K` / `OVERFETCH_FACTOR` — fusion constants reused by the
  4-list keyword-first fusion.
- `cosineSimilarityFromText` / `core_id` — used by the
  semantic-dilution cap for the overlap check and by the existing
  3-layer dedup.
- `searchMode` — additive non-breaking response-field precedent from
  feat-097.

## Constraints

- **Default behavior stays byte-identical to `main`.** Existing
  callers (apps/web, apps/mobile, apps/tv) must not see any change
  in ranking unless they explicitly pass `mode="keyword-first"`.
  Locked in by the regression snapshot test in Unit 2.
- **`mode` is a nullable String, not a closed enum.** Default
  `"hybrid"`; unknown values warn-and-fallback. Future modes
  (`"instant"`, `"persona-aware"`) ship as new values without
  schema changes.
- **DB infrastructure is shared, code paths are not.** New columns and indexes populate regardless of mode but are dormant on the hybrid path.
- **GIN byte-parity invariant.** Tsvector expression in the
  migration MUST match the keyword-first retriever expression
  byte-for-byte, or planner falls back to Seq Scan. Lift to TS
  constant; assert byte-equality. (R4 pattern.)
- **Strapi v5 raw SQL: snake-cased columns.** Verify with
  `\d videos` before writing the migration.
- **PostgreSQL 18 (Railway): no `?::jsonb::text[]` cast.** Use PG
  array literal format with `?::text[]`.
- **Cutover (flipping the default) is out of scope.** Documented in
  the plan; separate ticket after each consumer surface opts in and
  soaks ≥2 weeks.
- **Ships to `apps/cms` first.** Admin R4 port is a mechanical
  follow-up once Core sync data-model reshape lands; tracked
  separately.

## Verification

### Default-mode regression test (gating)

For a fixed query set across `(query, locale, limit, offset)`
tuples, response is **byte-identical** between `main` and this
branch when `mode` is unset or `mode="hybrid"`. Snapshot test
against a seeded DB. Captured against `main` BEFORE any
keyword-first code lands; must continue to pass through every
unit.

Fixed query set (minimum):

- `q="the Bible project"`, `locale="en"`, `limit=10`
- `q="forgiveness"`, `locale="en"`, `limit=10`
- `q="easter"`, `locale="en"`, `limit=10`
- `q="resurrection"`, `locale="es"`, `limit=10`
- `q="  "` (whitespace) — current error/empty behavior preserved

### Keyword-first acceptance test (gating)

Given `q="the Bible project"`, `locale="en"`, `limit=10`,
**`mode="keyword-first"`**:

- ≥8 of the top 10 results match `/bible\s*project/i` on `title`
- No result whose title lacks both "bible" AND "project" ranks
  above one whose title contains both
- Top 3 are all Bible Project videos

Test must FAIL on `main` (no keyword-first mode exists) and PASS
on this branch when `mode="keyword-first"` is passed; the SAME
query with `mode` unset continues to return the legacy diluted set
(covered by the regression test above).

Seed fixtures: 5 Bible Project titles, 3 unrelated "project"
videos, 3 unrelated "bible" videos (description-only).

### Secondary

- `EXPLAIN ANALYZE` on each new retriever shows `Bitmap Index
Scan` on the appropriate index (GIN trigram, weighted GIN
  tsvector). Any Seq Scan = GIN byte-parity drift; fix.
- Keyword-first canary on a thematic query (`q="hope when life is
hard"`): semantic-dilution cap does NOT trigger when there's no
  clear keyword winner; results overlap heavily with hybrid mode
  for this kind of query.
- Unknown-mode handling: `mode="garbage"` returns hybrid results +
  emits structured warning log; never errors.
- 24h passive canary diff between `mode="hybrid"` and
  `mode="keyword-first"` on a fixed query set in cms prod before
  declaring stable. Report in PR description.

## Notes

This is the "while we wait" work. The admin-side embedding
backfills (R1/R2/R3 of the admin migration playbook) are blocked
upstream: prod admin's Postgres has no Video / VideoEdition rows
because Core sync has only attempted the `languages` phase (errored
5×, never green), and the data model itself may reshape (editions
may not survive). This ticket is independent of any Core-sync or
data-model decisions — it ships to cms (Strapi consumers) where the
existing search API and embeddings already serve traffic, and the
admin R4 port becomes mechanical once the upstream reshape lands.
