---
title: "GIN byte-parity: expression indexes need shared constants; operator-class indexes don't"
category: "best-practices"
problem_type: "best_practice"
component: "database"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "medium"
module: "apps/cms"
tags:
  - postgres
  - gin-index
  - pg-trgm
  - tsvector
  - byte-parity
  - search
  - planner
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#feat-109"
related_docs:
  - "docs/solutions/platform/admin-hybrid-search-r4-pattern.md"
  - "docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md"
  - "docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md"
---

## Problem

When wiring keyword-first search retrievers to GIN indexes, it's tempting
to apply the byte-parity-via-shared-TS-constant pattern (the R4 admin
hybrid-search pattern) to **every** GIN index. But that pattern is only
load-bearing for **expression-based** GIN indexes. **Operator-class**
GIN indexes (e.g. `gin_trgm_ops` on a column) don't need byte-parity
guards — the planner picks them up for any operator-on-column predicate
regardless of alias. Treating both kinds as the same risks a false
sense of security and a misleading shared constant.

## Symptoms

A `TITLE_TRIGRAM_OP = "videos.title %> ?"` constant exported alongside
`WEIGHTED_TSV_EXPR` for byte-parity, but:

- The retriever uses `v.title %> ?` (table alias `v`, not `videos`).
- The constant is never imported.
- A reviewer notices the mismatch and asks "is the trigram path actually
  guarded?"
- Inspection shows the planner picks the GIN trigram index correctly
  even with the alias — because trigram indexes are operator-class-keyed,
  not expression-keyed.

## What Didn't Work

- Adding the trigram operator string as a shared constant. The constant
  is meaningless because alias differences don't affect index selection
  for operator-class indexes.
- Trying to make the bootstrap and retriever use the same alias. The
  retriever needs `v` for join scoping; the bootstrap CREATE INDEX uses
  the table name. Reconciling them produces ugly SQL without any
  planner-level benefit.

## Solution

Distinguish the two GIN-index kinds and apply byte-parity **only** to
expression indexes:

| GIN flavor               | Example                                                                                               | Byte-parity required?                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Expression-based         | `CREATE INDEX … ON videos USING gin ((setweight(title_tsv,'A') \|\| setweight(description_tsv,'B')))` | **Yes** — query WHERE/rank must reference the SAME expression byte-for-byte |
| Operator-class on column | `CREATE INDEX … ON videos USING gin (title gin_trgm_ops)`                                             | **No** — planner uses the index for any `title %> ?` regardless of alias    |

In `lexical-sql.ts` (or equivalent shared module), document this:

```ts
/**
 * GIN index names — kept here so the bootstrap module and any future
 * verifier (e.g. an `EXPLAIN`-based regression test) build from the same
 * source.
 *
 * Note: there is no shared constant for the trigram operator literal
 * (`%>`) because the GIN trigram index (`gin_trgm_ops` on the `title`
 * column) is operator-class-keyed, not expression-keyed — the planner
 * picks it up for any `title %> ?` regardless of alias. Byte-parity
 * matters for expression indexes (the weighted GIN above), not for
 * column-with-operator-class indexes.
 */
```

## Why This Works

The Postgres planner matches indexes to predicates differently depending
on the index kind:

- For an **expression** index, the planner matches the predicate's
  expression tree against the indexed expression. Whitespace doesn't
  matter, but normalization differences (`coalesce(title, '')` vs
  `COALESCE(title, '')` vs `coalesce("title", '')`) silently disable the
  match. Hence byte-parity via a shared constant is the right guard.
- For an **operator-class on a column** (like `gin_trgm_ops`), the
  planner matches the operator (`%>`) and the column reference. Aliases
  resolve to the same column at parse time, so `v.title %> ?` and
  `videos.title %> ?` are equivalent for index selection.

Confirming with `EXPLAIN ANALYZE` against a seeded fixture is the
authoritative check; the byte-parity unit test is a fast pre-commit
guard that's only meaningful for the expression case.

## Prevention

1. **In code review of new GIN indexes:** ask "is this expression-based
   or operator-class?" If expression-based, require a shared constant +
   byte-equality test. If operator-class, don't add a constant.
2. **In tests:** assert SQL substring (`expect(sql).toContain(...)`) for
   expression indexes. For operator-class indexes, an `EXPLAIN`-based
   integration test is the only meaningful check (substring assertions
   don't add value).
3. **Don't over-apply the R4 pattern.** The admin hybrid-search byte-
   parity pattern is documented for expression indexes specifically.
   Treating it as a universal "all GIN indexes need shared constants"
   rule produces noise and false confidence.

## Related

- `apps/cms/src/api/search/services/lexical-sql.ts` — the `WEIGHTED_TSV_EXPR`
  shared constant for the expression GIN, and the docstring distinguishing
  the trigram path.
- `apps/cms/src/bootstrap/ensure-search-lexical.ts` — bootstrap that
  references the constant for the weighted GIN, inlines the column for
  the trigram GIN.
- `apps/cms/src/api/search/services/keyword-weighted-search.ts` /
  `trigram-search.ts` — the two retrievers that exercise the distinction.

## Admin-side counterpart

The same distinction applies to admin's R4-extension keyword-first port:

- `apps/admin/src/services/hybrid-search-sql.ts` — `WEIGHTED_TSV_INDEX_EXPR`
  / `WEIGHTED_TSV_QUERY_EXPR` are byte-parity-guarded against
  `prisma/migrations/0009_keyword_first_lexical/migration.sql`. No
  shared constant for the trigram path — operator-class GIN
  (`gin_trgm_ops`) selects via the `%>` operator.
- `apps/admin/src/services/hybrid-search-sql.test.ts` — extended
  byte-parity test asserts both invariants.
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts` —
  `searchByKeywordWeighted` (expression GIN) vs `searchByTrigram`
  (operator-class GIN) showing the pattern in admin idiom.
- `docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md`.
