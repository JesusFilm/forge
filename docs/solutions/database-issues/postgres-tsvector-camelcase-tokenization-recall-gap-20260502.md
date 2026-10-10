---
title: Postgres `to_tsvector('simple', ...)` keeps CamelCased brands as a single lexeme — multi-word user queries silently miss
date: 2026-05-02
tags:
  [
    postgres,
    tsvector,
    full-text-search,
    pg_trgm,
    search-recall,
    camelcase,
    tokenization,
    websearch_to_tsquery,
  ]
category: database-issues
severity: medium
---

## Problem

Marketing copy and user-facing text frequently contains CamelCased brand names: `BibleProject`, `JesusFilm`, `BibleStudy`, `YouTube`, `iPhone`, `MacOS`. Postgres' default tokenizers treat these as **single lexemes** (`bibleproject`, `jesusfilm`) — they only split on non-alphanumeric boundaries, not on case transitions.

So a user typing the brand the natural way — _"the bible project"_ — produces a `websearch_to_tsquery('simple', ...)` that ANDs three separate tokens (`'the' & 'bible' & 'project'`), and that query **never matches** the single lexeme `bibleproject` sitting in the indexed tsvector. The row silently fails to surface even though the brand name is clearly there in the source text.

Algolia, Elasticsearch, and other search engines handle this for free because their default analyzers split CamelCase at index time. Postgres doesn't.

## Symptoms

- Multi-word user queries return drastically fewer results than equivalent searches against an Algolia / ES index built over the same content
- Specific symptom: querying for the brand returns **only** rows where the brand is also written with a space (or as the document title), but not rows where the brand appears joined-form in the description
- Symptom is corpus-wide and silent: nothing in logs, nothing in EXPLAIN — the index is being used correctly, the rows just don't match
- Trigram retrievers (`pg_trgm`) recover some of the recall (3-grams ignore token boundaries) but miss the canonical "lexical AND-of-tokens" hits

Live reproduction (admin's video search, 2026-05-02):

```sql
-- query produces three tokens, ANDed
SELECT websearch_to_tsquery('simple', 'the bible project')::text;
-- => 'the' & 'bible' & 'project'

-- description has BibleProject as one word
SELECT description_tsv @@ to_tsquery('simple', 'bible & project') AS m_two,
       description_tsv @@ to_tsquery('simple', 'bibleproject')   AS m_one
FROM video_locale WHERE title = 'The Lord''s Prayer' AND locale='en';
-- => m_two = false, m_one = true
```

14 of 20 BibleProject-series videos failed to match because their descriptions write the brand as `BibleProject` (one word) — the joined lexeme, not the split tokens.

## What Didn't Work

- **Switching to `to_tsvector('english', ...)`** — `english` config has the same tokenization rules (only splits on non-alphanumeric), and adds stemming on top. Doesn't fix CamelCase, introduces stem mismatches.
- **Using `to_tsquery` instead of `websearch_to_tsquery`** — same tokenizer, same problem; user has to manually quote phrases. Worse UX.
- **Spoofing prefix matches with `:*`** — would help if user types `bib`, but doesn't fix `the bible project` matching `bibleproject`.
- **Trigram-only retriever (`vl.title %> q`)** — works for the brand collection itself but title-side trigrams don't cover the description body where attribution text lives.

## Solution

Inject a space at every CamelCase boundary **before** tokenizing, by wrapping the tsvector expression with `regexp_replace`:

```sql
-- title_tsv generated column expression
to_tsvector('simple',
  regexp_replace(coalesce(title, ''), '([a-z])([A-Z])', '\1 \2', 'g'))

-- and the same for description_tsv
to_tsvector('simple',
  regexp_replace(coalesce(description, ''), '([a-z])([A-Z])', '\1 \2', 'g'))
```

`BibleProject` → `Bible Project` → tokenizes as `bible` + `project`. Both joined-form and split-form spellings now match for any user query phrasing. Generalizes to any CamelCased brand or compound (`JesusFilm`, `BibleStudy`, etc.) with no per-brand list.

The `[a-z][A-Z]` form is conservative on purpose: it preserves all-caps acronyms (`YHWH`, `LORD`, `iOS`-style trailing all-caps) intact while still splitting two-segment CamelCase. The more aggressive `[a-zA-Z][A-Z][a-z]` variant would break `YHWH` into `Y H W H`.

### As a Postgres `GENERATED ALWAYS AS ... STORED` column

The migration looks like:

```sql
ALTER TABLE "video_locale"
  ADD COLUMN "title_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      regexp_replace(coalesce(title, ''), '([a-z])([A-Z])', '\1 \2', 'g'))
  ) STORED;
```

If the column already exists with a different generated expression, **Postgres has no in-place editor**. The only path is `DROP COLUMN ... CASCADE + ADD COLUMN ... GENERATED`. CASCADE drops dependent indexes, which then need recreating. See the related solution doc on generated-column drift.

### Defense-in-depth: pair with a description trigram index

CamelCase split fixes the canonical case but doesn't help typos (`bibel project`) or partial input (`biblepro`). Add a trigram GIN index on the description column too:

```sql
CREATE INDEX "video_locale_description_trgm_idx"
  ON "video_locale"
  USING GIN (description gin_trgm_ops);
```

…and extend the trigram retriever to UNION title and description (or use an OR predicate with `DISTINCT ON` per row, ranking by `GREATEST(similarity(title, q), similarity(coalesce(description, ''), q))`).

The size precaution: pg_trgm GIN scales linearly with total characters indexed, and descriptions are typically 10–100× longer than titles. Capture `pg_relation_size()` once the corpus is populated and have a concrete revisit threshold (~500 MB, or >20% INSERT/UPDATE latency regression).

## Why This Works

Postgres' tokenizers split on non-alphanumeric boundaries only. They have no concept of "case transitions are also boundaries" because Latin-script word boundaries are language-specific and the simple/english configs intentionally stay locale-blind for performance. By doing the case-split in a regex _before_ tokenization, we make the boundary explicit at index time — so both spellings tokenize to the same lexeme set and a user query of either form matches.

The trick is purely a content transformation; the tsvector column then behaves identically to a column built over correctly-spaced text. No tokenizer config change, no extension dependency, no consumer-side query rewrite.

## Caveats

### 1. ASCII-only

`[a-z]` and `[A-Z]` are POSIX bracket character classes that match **only** ASCII Latin code points. Cyrillic CamelCase (`СловоБожие`), Greek, accented Latin (`JésusFilm`'s `s`-then-`F` works because both are ASCII), or any non-Latin alphabet does **not** split.

For multilingual corpora this is a real recall gap. The future fix is to broaden to `[[:lower:]]` / `[[:upper:]]` (Postgres POSIX classes that honor `LC_CTYPE`) — but that diverges from JavaScript's regex behavior and changes the recall curve in subtle ways. Benchmark before broadening.

### 2. Generated-column rewrite is destructive on populated tables

`DROP COLUMN ... CASCADE + ADD COLUMN ... GENERATED` rewrites every row. On a 0-row table (where this fix typically lands during a migration window) the cost is zero. On a populated table, it's a full table rewrite under `AccessExclusiveLock`. Don't ship this shape against a hot table without staging the DDL outside the Prisma transaction (split into pieces, use `CREATE INDEX CONCURRENTLY` via raw psql, or use Prisma's `Unsupported` escape hatch).

### 3. `websearch_to_tsquery` AND-of-tokens is the load-bearing surprise

The CamelCase miss is one specific symptom of a broader user-experience surprise: `websearch_to_tsquery('simple', 'the bible project')` produces `'the' & 'bible' & 'project'` — every token is required. Users typing multi-word queries expect "OR-with-a-rank-boost" semantics; Postgres gives them strict AND.

Mitigations beyond the CamelCase fix:

- Fan out into multiple retrievers (lexical AND, trigram OR, exact-title-AND-chain) and fuse via Reciprocal Rank Fusion (the R4 hybrid-search pattern).
- Feed `websearch_to_tsquery('simple', q)` through a tokenization step that ORs the individual lexemes too (`'the' | 'bible' | 'project'`) and rank by token count overlap. More invasive; pick when the AND-strict semantics is actually a recall problem in the user data, not just a theoretical one.

## Prevention

1. **For any new tsvector column over user-facing brand / marketing copy**, default to wrapping with the CamelCase-split regex. The cost is negligible (`regexp_replace` is fast); the cost of _not_ doing it is a silent recall gap that surfaces months later when someone diffs against an external search engine.

2. **Pair tsvector + trigram retrievers** for any catalog where users type natural-language queries against marketing copy. Each catches different failure modes; together they approximate Algolia-quality recall without leaving Postgres.

3. **Build a recall canary against a known-good external baseline** (Algolia, ES, manual spot-checks on a representative query set) and diff the top-N. The CamelCase gap was invisible in unit tests and only surfaced when a side-by-side canary route landed (admin's `/watch/demo-keyword-search` Algolia parity column, PR #864).

4. **Document the ASCII-only limit explicitly** in the migration comment + retriever JSDoc, so the next engineer touching multilingual recall doesn't assume the regex covers their locale.

### Test scaffold (JavaScript stand-in for Postgres regex)

Postgres' POSIX regex and JavaScript's regex implement non-Unicode-aware `[a-z]` / `[A-Z]` classes identically (both ASCII-only), so a JS test is a faithful stand-in for behavioural tests of the pattern itself:

```ts
const splitCamel = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2")

expect(splitCamel("BibleProject")).toBe("Bible Project")
expect(splitCamel("YHWH")).toBe("YHWH") // all-caps preserved
expect(splitCamel("BibleProjectVideo")).toBe("Bible Project Video")
expect(splitCamel("Bible Project")).toBe("Bible Project") // idempotent
expect(splitCamel("СловоБожие")).toBe("СловоБожие") // ASCII-only limit
```

A future broadening to `[[:lower:]]` / `[[:upper:]]` would diverge and need a real-DB test.

## Where this surfaced

- PR #864 (admin Algolia parity column on `/watch/demo-keyword-search`, 2026-04-30) — the side-by-side canary that exposed admin returning 6 hits where Algolia returned 20 for `q="the bible project"`.
- PR #872 (admin keyword-first CamelCase recall fix, 2026-05-02) — the migration that lands the CamelCase-split tsvector + description trigram fix. Recall jumped 6 → 20.
- Diagnostic walkthrough in the conversation transcript: `websearch_to_tsquery` token decomposition + per-row `description_tsv @@` checks confirmed root cause before the fix shipped.

## Related

- `apps/admin/prisma/migrations/0010_camelcase_tsv_and_description_trigram/migration.sql` — the canonical migration shape
- `apps/admin/src/services/hybrid-search-sql.ts` — `TITLE_TSV_GENERATED_EXPR` / `DESCRIPTION_TSV_GENERATED_EXPR` constants
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` — `searchByTrigram` extended to title + description
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md` — the DROP CASCADE + ADD GENERATED migration pattern this fix uses
- `docs/solutions/best-practices/gin-byte-parity-trigram-vs-expression-indexes-20260429.md` — the byte-parity invariant between TS constants and migration SQL that this fix preserves
- `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md` — the keyword-first orchestrator this fix extends
- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md` — original R4 hybrid search foundation
- `docs/research/semantic-search-report.md` §6 "Adding Algolia-like Functionality" — broader context on recall-gap mitigations
