---
title: "Assert Prisma raw-SQL invariants by scraping the tagged-template text"
date: 2026-04-23
category: best-practices
problem_type: best_practice
component: testing_framework
root_cause: inadequate_documentation
resolution_type: workflow_improvement
severity: medium
tags:
  - testing
  - prisma
  - raw-sql
  - pgvector
  - admin
  - review-driven
related_prs:
  - 838
related_files:
  - apps/admin/src/services/scene-recommendations-retriever.test.ts
  - apps/admin/src/services/hybrid-search-sql.test.ts
  - apps/admin/CLAUDE.md
applies_to:
  - apps/admin
  - apps/cms
  - apps/manager
---

# Assert Prisma raw-SQL invariants by scraping the tagged-template text

## Problem

Admin retrievers that use raw SQL via Prisma's `$queryRaw` have
correctness invariants encoded in specific SQL clauses — `DISTINCT ON`,
`INNER JOIN` vs `LEFT JOIN`, locale filters, partial-index alignment,
exclusion predicates. When unit tests mock `$queryRaw` and only assert
on row mapping, a refactor can silently change load-bearing SQL — swap
INNER to LEFT, drop `DISTINCT ON`, forget a filter — and every test
still passes. The regression only surfaces in production via canary
diffs against cms.

Concrete trigger: R5 admin scene-recommendations port (PR #838) shipped
`apps/admin/src/services/scene-recommendations-retriever.ts` with raw
SQL; round-1 tests verified `row.video_slug → rec.videoSlug` mapping
but asserted nothing about the SQL shape. `apps/admin/CLAUDE.md`
explicitly named INNER JOIN on `dub/mux` as "the key R5 invariant" (it
preserves cms's non-null `playbackId` contract), yet no test enforced
it. ce:review's testing persona caught the gap.

## Symptoms

- Tests are green, but a refactor that changes SQL semantics ships
  undetected.
- Invariants called out in design docs / CLAUDE.md have no automated
  enforcement.
- The only line of defence is a canary diff against cms in production —
  slow feedback, user-visible blast radius.
- Row-mapping-only tests give false confidence: they prove the mapper
  works but are blind to whether the right SQL produced the row.

## What Didn't Work

- **Row-mapping-only tests.** Verify shape of output, not shape of
  query. Completely blind to clause drift.
- **Relying on a DB-backed integration test.** Does catch this, but
  adds infrastructure cost (test DB, seed data, HNSW index setup) and
  runtime. Overkill for asserting clause presence at unit-test speed.
- **Regexes that span Prisma interpolation boundaries.** Prisma
  replaces each `${var}` with a gap when the `TemplateStringsArray` is
  joined, so a regex like `/locale\s*=\s*'en'/` never matches.

## Solution

Add SQL-text assertions that scrape the tagged-template argument
Prisma passes to `$queryRaw`. `mock.calls[0][0]` is the raw
`TemplateStringsArray`; `.join(" ")` produces a readable string with
interpolation sites replaced by a single space, and regexes against
that string act as structural checks on SQL shape.

```ts
it("SQL invariant: DISTINCT ON + locale filter + INNER mux join + exclude-by-ALL", async () => {
  prisma.$queryRaw.mockResolvedValueOnce([])
  await queryScenesSimilar(prisma, "[0.1]", "en", ["self-id"], 10)
  const call = prisma.$queryRaw.mock.calls[0]!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql = String((call[0] as any).join(" "))
  expect(sql).toMatch(/DISTINCT ON\s*\(\s*vs\.video_id\s*\)/)
  expect(sql).toMatch(/v\.deleted_at IS NULL/)
  expect(sql).toMatch(/vl\.status\s*=\s*'published'/)
  // INNER JOIN on dub/mux (not LEFT JOIN) — preserves cms's non-null
  // playbackId guarantee. See CLAUDE.md R5 "Common things to remember".
  expect(sql).toMatch(/JOIN LATERAL/)
  expect(sql).not.toMatch(/LEFT JOIN LATERAL/)
  expect(sql).not.toMatch(/LEFT\s+JOIN\s+mux_video/)
  expect(sql).toMatch(/mv\.playback_id IS NOT NULL/)
  expect(sql).toMatch(/vsl\.embedding IS NOT NULL/)
  expect(sql).toMatch(/vs\.video_id\s*<>\s*ALL/)
})
```

## Why This Works

Prisma's `$queryRaw` receives the raw `TemplateStringsArray` as its
first argument. When `vi.fn()` records the call,
`mock.calls[0][0]` is that array — the literal SQL chunks between
interpolation sites, exactly as the author wrote them. Joining with
`" "` yields a readable string where each `${param}` boundary becomes
a single-space gap. Regexes targeting clauses _between_ interpolation
sites are therefore stable, deterministic structural checks.

A future author who flips INNER to LEFT, drops `DISTINCT ON`, forgets
the locale filter, or breaks HNSW partial-index alignment
(`embedding IS NOT NULL`) gets an immediate red test at unit-test
speed — no DB, no seed, no integration harness.

**Critical constraint:** Regexes must not span interpolation
boundaries. `/locale\s*=\s*'en'/` fails because `${locale}` becomes a
gap. Match up to the placeholder (`/vsl\.locale\s*=/`) and, if the
bound value matters, cross-reference `call[1]`, `call[2]`, … for the
interpolated arguments.

## Prevention

Any admin retriever whose correctness depends on a specific SQL
clause — `DISTINCT ON`, JOIN type, partial-index alignment, CTE
structure, WHERE predicates that gate pgvector / HNSW usage — must
ship with an SQL-text invariant test the **first time it lands**.
This is cheaper than a DB-backed integration test and catches the
high-frequency regression class: silent clause drift during
refactors.

Checklist when adding a new `$queryRaw` retriever:

1. List the load-bearing clauses (the ones whose removal would be a
   correctness bug, not a style change).
2. Add one invariant test that asserts each clause via regex against
   the joined `TemplateStringsArray`.
3. Include negative assertions (`.not.toMatch(/LEFT JOIN/)`) for
   clauses whose _absence_ is load-bearing.
4. Keep regexes within single SQL chunks — never across `${...}`
   boundaries.
5. Cross-reference any invariant called out in CLAUDE.md or the
   roadmap feature file; those are the ones most likely to be
   silently broken by a well-meaning refactor.

## See also

- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md` — R4's
  GIN-index byte-parity invariant is the sibling technique for a
  different topology: file-based substring assertion over an exported
  SQL builder. Use that pattern when the SQL is generated from a
  shared constant; use this doc's pattern when the SQL lives inline
  in the retriever.
- `docs/solutions/platform/admin-scene-recommendations-r5-pattern.md` —
  the R5 pattern that this testing technique gates.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md` —
  ce:review lineage; companion to this doc in the "invariants that
  must hold vs. invariants that are silently dead" split.
