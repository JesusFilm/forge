---
title: "fix: Keyword-first recall on CamelCased brand queries (BibleProject parity with Algolia)"
type: fix
status: active
date: 2026-05-02
---

# fix: Keyword-first recall on CamelCased brand queries (BibleProject parity with Algolia)

## Overview

Two coordinated changes to admin's keyword-first hybrid search retrievers so the `q="the bible project"` canary returns the full BibleProject series (currently 6 hits, expected ~15–20 to match Algolia's stg corpus). Root cause confirmed via psql in the 2026-05-02 diagnostic session: descriptions write the brand as one word (`BibleProject`), Postgres `to_tsvector('simple', ...)` keeps it as the single lexeme `bibleproject`, and `websearch_to_tsquery('simple', 'the bible project')` produces `'the' & 'bible' & 'project'` (three tokens, ANDed) which never matches the lexeme.

Fix is two complementary techniques shipped together:

1. **CamelCase-split before tokenizing** — modify the `title_tsv` / `description_tsv` GENERATED column expressions on `video_locale` to inject a space at every camelCase boundary before `to_tsvector` runs. `BibleProject` → `Bible Project` → tokens `bible` + `project`. Both single-word and two-word user queries now match. Generalizes to any CamelCased brand or compound (JesusFilm, BibleStudy, etc.).
2. **Extend trigram retriever to title+description** — add a trigram GIN index on `video_locale.description` and update `searchByTrigram` to UNION title-side and description-side matches. Trigrams ignore token boundaries entirely (`bible project` 3-grams overlap `bibleproject` directly), catching CamelCase, typos, and partial matches as defense-in-depth beyond what (1) alone covers.

Hybrid mode (default, byte-identical to R4) stays untouched — both fixes are keyword-first-mode-only.

## Problem Frame

Admin's hybrid-search keyword-first mode (R4 extension, 2026-04-29) was tuned for "natural" multi-word queries against typical title/description copy. The `BibleProject` brand pattern — one CamelCased word in marketing attribution text across 14+ Sermon-on-the-Mount and related videos — defeats the simple tokenizer in two ways: titles don't contain the brand at all (so trigram and exact-title fail), and descriptions contain the brand only as the joined-form lexeme `bibleproject` (so `websearch_to_tsquery` AND-of-tokens fails).

Algolia handles this for free because its default tokenizer splits CamelCase and adds prefix matches at index time — every BibleProject record indexes both `bibleproject` AND `bible` + `project`. The session-2026-05-02 demo-keyword-search diff against `q="the bible project"` showed admin returning 6 hits (BibleProject Collection + 4 Gospel Parts + StoryClubs) versus Algolia returning 20+ (the full Sermon-on-the-Mount series, Wisdom Within Laws series, Beatitudes, Shema, etc.). Per-row token-presence verification confirmed all 14 missing videos exist in admin's local DB with the brand attribution intact — the gap is purely the tokenization mismatch.

## Requirements Trace

- R1. For `q="the bible project"`, keyword-first mode returns at least 15 of the ~20 videos Algolia stg returns. Validated via the demo-keyword-search canary (manual) and a strengthened bible-project headline test (automated).
- R2. The CamelCase-split tokenization generalizes — any CamelCased brand in `title` or `description` becomes searchable as both the joined form and the split form. Verified via a unit test with synthetic CamelCased fixtures.
- R3. Hybrid mode (default, byte-identical to R4) remains byte-identical post-change. Enforced by `apps/admin/src/services/hybrid-search.regression.test.ts`.
- R4. Byte-parity invariant between TypeScript `*_GENERATED_EXPR` constants and the migration SQL is preserved. Enforced by `apps/admin/src/services/hybrid-search-sql.test.ts`.
- R5. Generated-column rewrite uses the coordinated `DROP COLUMN ... CASCADE + ADD COLUMN ... GENERATED ALWAYS AS (...)` pattern (no in-place ALTER attempt). Per `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`.
- R6. New description trigram index `CREATE INDEX CONCURRENTLY` not required (admin uses `prisma migrate deploy` which runs in a transaction; non-concurrent CREATE INDEX is the convention). Sized + verified via `pg_relation_size` against the local backfilled DB.

## Scope Boundaries

- **Only the keyword-first mode retrievers + their generated-column inputs.** No changes to hybrid-mode retrievers (`searchVideoSemantic`, `searchVideoKeyword`), no changes to fusion / dedup, no changes to `searchExperience*`. Hybrid mode reads the same `title_tsv` / `description_tsv` columns post-fix, so its tsquery results may shift slightly when descriptions contain CamelCased brands — this is acceptable because the regression test asserts byte-identity against deterministic mocked retrievers, not against real DB content. Re-verify the regression-test mocks are unchanged.
- **No changes to the `searchByKeywordWeighted` SQL beyond reading the regenerated columns.** The retriever's expression and rank function stay the same; only the underlying tsvector column content changes.
- **No changes to the demo-keyword-search throwaway harness.** That tool exists to validate this fix, not to be modified by it.
- **No new ranking weights, no editorial-boost field, no parent-child collection expansion.** Those are separate semantic-search-report.md follow-ups; out of scope here.
- **No production data migration concerns.** Admin's prod `video` / `video_locale` tables are 0 rows today (R0 backfill not yet run). The generated-column rewrite is a no-op in prod; on local + stage envs, regeneration runs over the test corpus during `prisma migrate deploy`.
- **No changes to title-side trigram retriever shape or index name.** The existing `video_locale_title_trgm_idx` stays; only a new `video_locale_description_trgm_idx` is added and `searchByTrigram` learns to query both.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/prisma/migrations/0009_keyword_first_lexical/migration.sql` — current generated-column definitions + indexes for the keyword-first work. The new migration must reference it as the predecessor.
- `apps/admin/src/services/hybrid-search-sql.ts` — `TITLE_TSV_GENERATED_EXPR` (line ~129), `DESCRIPTION_TSV_GENERATED_EXPR` (line ~139), `WEIGHTED_TSV_INDEX_EXPR` (line ~152), `WEIGHTED_TSV_QUERY_EXPR` (line ~164). All four are byte-parity-locked with the migration.
- `apps/admin/src/services/hybrid-search-sql.test.ts` — reads the 0009 migration file and asserts byte-equality against the constants. Will need to either point at the new migration or include both depending on convention.
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` — `searchByTrigram` is title-only today; this unit extends it.
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.test.ts` — existing trigram-path tests; new tests for description-side matches and per-row dedup.
- `apps/admin/src/services/hybrid-search.bible-project.test.ts` — currently asserts top-3 are all `/bible\s*project/i` titles. Strengthen to assert top-N includes ≥5 Sermon-on-the-Mount titles (Lord's Prayer, Shema, YHWH, Beatitudes, Sermon on the Mount, etc.).
- `apps/admin/src/services/hybrid-search.regression.test.ts` — protects hybrid mode's byte-identity. Re-run on every commit; should stay green.
- `apps/admin/src/app/watch/demo-keyword-search/` — throwaway canary for live verification (untouched by this plan).

### Institutional Learnings

- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md` — Postgres has no `ALTER COLUMN ... GENERATED` editor for stored expressions. Coordinated `DROP COLUMN ... CASCADE + ADD COLUMN ... GENERATED` migration is the only correct path.
- `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md` — operator-class GIN (`gin_trgm_ops`) doesn't need a shared constant for byte-parity; index selection happens via the `%>` / `%` operators. The new description trigram index follows the title trigram pattern.
- `docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md` — Prisma's schema mirror needs the column declared as `Unsupported("tsvector")` (or similar) to keep its diff reconciliation happy when the column is migration-managed.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md` — re-derive every SQL invariant against admin's current schema, not against cms's older shape. Already applied in R4; this fix doesn't introduce new invariants.
- `apps/admin/CLAUDE.md` "Hybrid search keyword-first mode (R4 extension)" section — describes the byte-parity invariant, the generated-column drift trap, and the operational runbook (EXPLAIN ANALYZE for index selection).
- `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md` — the regression-test approach used by `hybrid-search.regression.test.ts`. Don't break the snapshot.

### External References

None gathered — Postgres `to_tsvector` / `websearch_to_tsquery` / pg_trgm semantics are stable and well-documented in the local solutions corpus. The CamelCase-split regex pattern (`'([a-z])([A-Z])'`) is the canonical Postgres recipe for this transformation; both forms (one-letter and multi-letter prefix variants) are equivalent for our case since admin's brands are simple two-segment CamelCase.

## Key Technical Decisions

- **Single new migration** that does both the generated-column rewrite AND the description trigram index. Atomic from an admin-deploy standpoint; both ship or neither does. The two changes are conceptually independent but operationally coupled (both touch `video_locale` + both want the same backfill pass).
- **CamelCase regex applied to both `title` and `description`**, not just description. Titles in admin are usually space-separated already, but applying the regex uniformly: (a) keeps the two `*_GENERATED_EXPR` constants symmetric, (b) cheap insurance against future title copy that uses CamelCase brands (e.g., `JesusFilm` in a future title), (c) avoids subtle differences in how titles vs descriptions tokenize.
- **The regex `([a-z])([A-Z])` over the lower-then-upper boundary**, not the more aggressive `([a-zA-Z])([A-Z][a-z])` variant. The simpler form preserves all-caps acronyms (`YHWH`, `LORD`) intact rather than breaking them into single letters. Admin has YHWH-titled videos in the corpus; the simpler regex leaves them as one token, which is correct.
- **Description trigram index alongside the existing title trigram index, not replacing it.** Two indexes, two query paths in `searchByTrigram`. UNION via SQL with per-row dedup at the boundary (same video_id rows collapsed; rank by `GREATEST(similarity(title, q), similarity(description, q))`).
- **Non-concurrent `CREATE INDEX`** in the migration. Admin uses `prisma migrate deploy` which runs migrations in transactions; `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Acceptable because admin's prod corpus is 0 rows today and the index will populate as part of the R0 backfill flow (not as a hot-path operation against a busy table).
- **No `IF NOT EXISTS` guard on the new trigram index.** The migration is forward-only and authored once; failing on duplicate creation is the correct behavior, surfacing the mistake immediately. (The IF NOT EXISTS pattern is reserved for the generated-column drift case where re-running is a recovery path.)
- **Bible-project headline test gets a stronger top-N assertion.** Today: top-3 are all `/bible\s*project/i` titles. Strengthen: top-15 includes at least 5 of `[The Lord's Prayer, Shema, YHWH, Beatitudes, Sermon on the Mount, Wisdom Within Laws (any), Wisdom in Relationships, The Choice, Jesus Fulfills the Law, Intro to Sermon on the Mount, Nephesh, Advent Series]`. The list is conservative — the local DB content is known, so the test asserts a concrete recall floor.
- **Skip a separate verification migration script.** Admin's existing test suite (`hybrid-search-sql.test.ts` for byte-parity, `hybrid-search.bible-project.test.ts` for recall, `hybrid-search.regression.test.ts` for hybrid byte-identity) already covers what we'd verify. Adding a one-off script is YAGNI.

## Open Questions

### Resolved During Planning

- **Why CamelCase-split AND trigram on description, instead of just one?** Defense in depth + each catches different failure modes. CamelCase-split fixes the BibleProject case exactly. Description trigram catches typos ("biblproject"), partial input ("biblepro"), and any future CamelCased brand we forget exists. Combined cost is one migration + one new index + ~30 lines of SQL in `searchByTrigram`.
- **Will the regex break existing passing tests?** Hybrid-mode regression test uses deterministic mocked retrievers, not real DB content — green. Byte-parity test reads the migration; updated together — green. Bible-project test currently passes with admin returning the BibleProject Collection at #1; the strengthened assertion uses the same fixture but adds expectations.
- **Migration sequencing — does the generated-column rewrite need to run before the trigram index?** No. They're independent. Same migration file, two top-level statements. Postgres applies them in declaration order regardless.
- **What about `\W`-stripping or accent-folding?** Out of scope. The brand-attribution failure is purely a CamelCase tokenization issue. Accent folding is a separate concern with its own tradeoffs (Unicode normalization, locale collation) and isn't required to close the BibleProject recall gap.
- **Should we also cover the lower-then-digit boundary (`Genesis19` → `Genesis 19`)?** Not now. Admin's title and description corpus doesn't show that pattern affecting recall. Pure CamelCase boundary is enough; revisit if a future query class fails on number-suffixed tokens.

### Deferred to Implementation

- **Exact form of the SQL UNION in `searchByTrigram`** — `UNION ALL` + outer GROUP BY for dedup, vs. `UNION` (which dedups) + a different rank synthesis, vs. two separate CTEs joined. Pick the form that reads cleanest given the existing retriever's structure; verify with EXPLAIN ANALYZE that both indexes are selected.
- **`pg_relation_size` of the new description trigram index** on the local backfilled corpus. Capture as part of Unit 4 verification; if it's > 1 GB, surface as a follow-up risk for the R0-prod-backfill rollout (but don't block landing — admin has zero prod data today).
- **Whether the strengthened bible-project test's recall floor (≥5 of 12 candidate titles in top-15) is the right number.** Tune to whatever the local fix actually produces; the floor should be high enough to lock in the improvement, low enough not to flake on small ranking shifts. Pick during Unit 4.
- **Handling of `text` vs `varchar(N)` differences in the regex output.** `regexp_replace` returns `text`; `to_tsvector` accepts both. Trivial but verify the migration runs without an explicit cast.

## Implementation Units

- [ ] **Unit 1: Migration — CamelCase-split generated columns + description trigram index**

**Goal:** Write a single forward-only migration that drops + recreates `title_tsv` / `description_tsv` with the CamelCase-split expression, and adds a trigram GIN index on `description`.

**Requirements:** R2, R5, R6.

**Dependencies:** None (admin's `pg_trgm` extension was provisioned by `0009_keyword_first_lexical`).

**Files:**

- Create: `apps/admin/prisma/migrations/0010_camelcase_tsv_and_description_trigram/migration.sql`
- Modify (Prisma schema mirror): `apps/admin/prisma/schema.prisma` — verify `title_tsv` / `description_tsv` declarations still match (likely no change needed if they're `Unsupported("tsvector")?`)

**Approach:**

- Drop both existing generated columns with `CASCADE` (drops `video_locale_lexical_weighted_idx` automatically — the migration recreates it).
- Re-add `title_tsv` and `description_tsv` as `GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(coalesce(<col>, ''), '([a-z])([A-Z])', '\1 \2', 'g'))) STORED`.
- Recreate `video_locale_lexical_weighted_idx` over the weighted expression (same as 0009 — byte-equal to `WEIGHTED_TSV_INDEX_EXPR`).
- Recreate `video_locale_fulltext_search_idx` (the R4 GIN index referenced in `searchVideoKeyword`) — confirm it was column-based not expression-based; if expression-based on the OLD `to_tsvector` call, it must also drop+recreate to use the new column content. Per CLAUDE.md the R4 index is over `to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))` — that expression is unchanged by this migration (still operates on raw `title`/`description`, not on `*_tsv`), but its CONTENT now differs because... actually no, the R4 index expression is independent of the regenerated columns. It builds its tsvector on the fly from raw `title`/`description`. So it does NOT pick up the CamelCase split. **Decision:** the R4 index continues to use the un-split tokenization; that's correct because hybrid mode (which uses the R4 index via `searchVideoKeyword`) must stay byte-identical. Hybrid mode's recall on CamelCased brands is unchanged by this fix; only keyword-first mode picks up the improvement.
- Add `CREATE INDEX video_locale_description_trgm_idx ON video_locale USING gin (description gin_trgm_ops);`.
- Add a comment header in the migration referencing the byte-parity contract with `hybrid-search-sql.ts` and the parent solutions doc on generated-column drift.

**Patterns to follow:**

- `apps/admin/prisma/migrations/0009_keyword_first_lexical/migration.sql` for the generated-column shape and the trigram index syntax.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md` for the DROP CASCADE + ADD pattern.

**Test scenarios:**

- (covered by Unit 2's byte-parity test) Migration file's generated-column expressions are byte-equal to `TITLE_TSV_GENERATED_EXPR` / `DESCRIPTION_TSV_GENERATED_EXPR`.
- Migration runs cleanly via `pnpm --filter @forge/admin db:migrate:dev` against local Postgres.
- After migration, `SELECT title_tsv, description_tsv FROM video_locale WHERE title = 'The BibleProject Collection' LIMIT 1` shows tokens including both `bibleproject` AND `bible` + `project` (or shows only the split form, depending on whether the regex is applied before or after concatenation — verify which).

**Verification:**

- `pnpm --filter @forge/admin db:migrate:dev` succeeds on a fresh local DB.
- `\d+ video_locale` shows both columns with the new generated expression.
- `\di video_locale*` shows `video_locale_description_trgm_idx` exists with `gin_trgm_ops`.

---

- [ ] **Unit 2: Update TypeScript constants + byte-parity test pointer**

**Goal:** Update the `*_GENERATED_EXPR` constants in `hybrid-search-sql.ts` to match the new migration, byte-equal. Update the byte-parity test to read the new migration file (or both, depending on the existing test's pattern).

**Requirements:** R4.

**Dependencies:** Unit 1.

**Files:**

- Modify: `apps/admin/src/services/hybrid-search-sql.ts` — `TITLE_TSV_GENERATED_EXPR`, `DESCRIPTION_TSV_GENERATED_EXPR`. (`WEIGHTED_TSV_INDEX_EXPR` and `WEIGHTED_TSV_QUERY_EXPR` are unchanged — they reference the columns, not the expressions inside them.)
- Modify: `apps/admin/src/services/hybrid-search-sql.test.ts` — update the migration file path used by the byte-parity assertion to point at the new `0010_*` migration. If the test reads ALL migration files, no change needed.

**Approach:**

- The new constant values are the regex-wrapped `to_tsvector('simple', regexp_replace(coalesce(<col>, ''), '([a-z])([A-Z])', '\1 \2', 'g'))`.
- Update the JSDoc on each constant to mention the CamelCase-split intent + reference the new migration.
- Confirm by running `pnpm --filter @forge/admin test src/services/hybrid-search-sql.test.ts` — should pass.

**Patterns to follow:**

- The existing byte-parity test pattern (reads migration text, asserts substring match against the constant) — mirror it for the new constants.

**Test scenarios:**

- Byte-parity test passes: every `*_GENERATED_EXPR` constant appears verbatim in the new migration.
- A small unit can also verify a sample CamelCase string transforms as expected: `to_tsvector('simple', regexp_replace('BibleProject', '([a-z])([A-Z])', '\1 \2', 'g'))` produces tokens `bible` + `project` (run via raw `$queryRaw` against the test DB).

**Verification:**

- `pnpm --filter @forge/admin test src/services/hybrid-search-sql.test.ts` green.
- `pnpm --filter @forge/admin typecheck` clean.

---

- [ ] **Unit 3: Extend `searchByTrigram` to title+description**

**Goal:** Update the trigram retriever to UNION title-side and description-side matches, with per-row dedup and `GREATEST(similarity(title, q), similarity(description, q))` ranking.

**Requirements:** R1.

**Dependencies:** Unit 1 (the new description trigram index must exist for this query to use the index path).

**Files:**

- Modify: `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` — `searchByTrigram`.
- Modify: `apps/admin/src/services/hybrid-search-keyword-first-retrievers.test.ts` — add description-match scenarios.

**Approach:**

- The retriever currently uses `vl.title %> $1` with `similarity(vl.title, $1)` ranking. Extend to a UNION of two halves: title-match path (unchanged) and description-match path (`vl.description %> $1` with `similarity(vl.description, $1)`).
- Per-row dedup: same video_id can appear via both halves; collapse to one row keeping the higher similarity score. Either via `UNION` (which dedups), or `UNION ALL` + outer GROUP BY video_id.
- Honor the existing R4-extension chain: locale + status + `deleted_at IS NULL`.
- Cap the limit at the same `limit * OVERFETCH_FACTOR` used elsewhere in the keyword-first retrievers.

**Patterns to follow:**

- The existing `searchByTrigram` for the title-side query shape.
- `searchByKeywordWeighted` for the LATERAL playback resolution + status filter pattern.
- `apps/cms/src/api/search/services/keyword-weighted-search.ts` if a sibling exists for cross-checking.

**Test scenarios:**

- Hit-via-title-only: query matches title's trigram; description doesn't contain the query. Result includes the row, similarity reflects the title score.
- Hit-via-description-only: query matches description's trigram; title doesn't. Result includes the row, similarity reflects the description score. Specifically: `q="bibleproject"` matches "The Lord's Prayer" via its description.
- Hit-via-both: query matches both; result row appears once, similarity is the GREATEST of the two.
- Locale/status filter respected: row in a different locale or with `status != 'published'` does NOT appear.
- Soft-deleted video excluded: `v.deleted_at IS NOT NULL` rows do NOT appear.
- Limit respected: result count ≤ `limit * OVERFETCH_FACTOR`.

**Verification:**

- `pnpm --filter @forge/admin test src/services/hybrid-search-keyword-first-retrievers.test.ts` green.
- Manual `EXPLAIN ANALYZE` shows both `video_locale_title_trgm_idx` AND `video_locale_description_trgm_idx` appear in the plan for a query that matches both fields.

---

- [ ] **Unit 4: Strengthen bible-project headline test + verify regression-test invariant**

**Goal:** Lock in the recall improvement with a stronger assertion in the bible-project headline test. Confirm hybrid-mode regression test still passes.

**Requirements:** R1, R3.

**Dependencies:** Units 1–3.

**Files:**

- Modify: `apps/admin/src/services/hybrid-search.bible-project.test.ts` — add the top-N recall assertion.
- (verify only) `apps/admin/src/services/hybrid-search.regression.test.ts` — should pass unchanged.
- (verify only) `apps/admin/src/services/hybrid-search.keyword-first.test.ts` — should pass unchanged or update fixtures if they overlap with the corpus shift.

**Approach:**

- Existing test asserts top-3 titles all match `/bible\s*project/i`. Keep that, add a parallel assertion that top-15 includes at least 5 titles from a curated list of Sermon-on-the-Mount + BibleProject series titles known to exist in the local fixture corpus (Lord's Prayer, Shema, YHWH, Beatitudes, Sermon on the Mount, Wisdom Within Laws (Murder/Adultery/Divorce), Wisdom in Relationships, The Choice, Jesus Fulfills the Law, Intro to Sermon on the Mount, Nephesh, Advent Series). Floor of 5 is conservative — actual results will likely surface more.
- Run `hybrid-search.regression.test.ts` to confirm hybrid mode's byte-identity-against-mocks still holds. If it fails, the regression-test mocks have somehow taken a dependency on the new tsvector content (they shouldn't), and the failure is the right place to investigate.

**Test scenarios:**

- top-3 are all bible-project titles (existing).
- top-15 includes ≥5 of the curated Sermon-on-the-Mount list (new).
- Hybrid mode regression test stays green (existing — verification only).

**Verification:**

- `pnpm --filter @forge/admin test src/services/hybrid-search.bible-project.test.ts` green with new assertion.
- `pnpm --filter @forge/admin test src/services/hybrid-search.regression.test.ts` green.
- Manual canary at `http://localhost:3003/watch/demo-keyword-search?q=the+bible+project&locale=en&limit=20&k=20`: keyword-first column shows ≥15 results, "Algolia ∩ Keyword" tile and "In all 3" tile populated with multiple slugs.

## System-Wide Impact

- **Interaction graph:** generated-column regeneration runs once per `prisma migrate deploy` invocation. Backfill cost = O(rows × description-length) but admin's prod corpus is 0 rows today; on local + stage envs the cost is bounded by test-fixture size.
- **Error propagation:** migration failure leaves the DB in a broken state (columns dropped but not recreated). The forward-only migration is wrapped in a transaction by `prisma migrate deploy`, so partial-failure rollback is automatic — but a failed migration on a deployed environment requires manual `prisma migrate resolve --rolled-back` per the existing playbook in `apps/admin/CLAUDE.md`.
- **State lifecycle risks:** the regenerated columns will produce different lexemes than the old columns. Any cached query results downstream would be stale. Admin doesn't cache search results today, so this is moot — but if a future cache lands, this fix is a cache-invalidation event.
- **API surface parity:** none — keyword-first is admin-internal today (no consumer outside the demo route + the future apps/web cutover at R8). The contract (`HybridSearchResult` shape) is unchanged.
- **Integration coverage:** the bible-project headline test is the integration probe. The regression test guards hybrid mode's contract. No new cross-layer scenarios introduced.

## Risks & Dependencies

- **Hybrid-mode regression test could fail unexpectedly** if its mocks somehow depend on the new tsvector content (they shouldn't — mocks are typed return values, not real SQL). If it does fail, the right answer is to fix the mock dependency, not weaken the regression assertion.
- **CamelCase regex misclassifies a real-world string.** Examples: `iPhone` → `i Phone` (correct); `YHWH` → unchanged (correct, all-caps preserved); `iOS` → unchanged (no lower-then-upper boundary); `MacOS` → `Mac OS` (correct). The chosen regex (`([a-z])([A-Z])`) is the conservative form. Anything we tokenize as one piece that should be two pieces (or vice versa) shows up as a recall miss against future canary queries — log and revisit.
- **Description trigram index size.** Per `apps/admin/CLAUDE.md` R4-extension notes, this was explicitly avoided in R4 because of corpus-size concerns. The 2026-05-02 reasoning to add it now: admin's prod corpus is 0 rows, so the size penalty is theoretical until R0 backfill. **Mitigation:** capture `pg_relation_size('video_locale_description_trgm_idx')` after local backfill in the Unit 4 verification log; if > 1 GB, surface as a follow-up to consider partial indexing or alternative approaches before R0 prod backfill.
- **Migration ordering in a multi-app deploy.** This migration is admin-only and doesn't touch shared infra. apps/cms's keyword-first port (`docs/plans/2026-04-29-002-feat-search-cms-to-admin-keyword-first-port-plan.md`) does NOT need a parallel change unless the cms-side R4 sibling work also needs CamelCase recall — out of scope here, follow-up if so.

## Documentation / Operational Notes

- Update `apps/admin/CLAUDE.md` "Hybrid search keyword-first mode (R4 extension)" section: brief addendum noting that the generated-column expressions now CamelCase-split before tokenizing, and that `searchByTrigram` queries title+description. Reference the new migration `0010_camelcase_tsv_and_description_trigram`.
- No solutions doc needed for the fix itself — but the BibleProject root-cause investigation produced reusable diagnostic moves (psql `to_tsquery` + `position()` + `description_tsv @@` checks). Those are worth a separate `ce:compound` capture as a "diagnosing keyword-search recall gaps" runbook. **Defer to a follow-up `ce:compound` after this lands** so the doc cites concrete file paths from the merged fix.
- No Railway env-var changes, no Doppler changes. Pure code + migration.

## Sources & References

- Diagnostic session 2026-05-02 (this conversation) — root cause confirmed via psql; demo-keyword-search canary; per-video token-presence verification.
- `apps/admin/CLAUDE.md` "Hybrid search keyword-first mode (R4 extension)" + "Common pitfalls" sections.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
- `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md`
- `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md`
- `apps/admin/prisma/migrations/0009_keyword_first_lexical/migration.sql` — predecessor pattern.
- `apps/admin/src/services/hybrid-search-sql.ts` — byte-parity-locked constants.
- `docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md` — R4-extension origin.
- `docs/plans/2026-04-30-001-feat-algolia-column-demo-keyword-search-plan.md` — the canary that surfaced the recall gap.
