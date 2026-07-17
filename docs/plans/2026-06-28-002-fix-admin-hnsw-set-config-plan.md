---
title: "fix: Repair Admin HNSW prototype pgvector settings"
type: "fix"
date: "2026-06-28"
execution: "code"
---

# fix: Repair Admin HNSW prototype pgvector settings

## Summary

Repair the internal Admin `semantic-hnsw-prototype` path so its transaction-local
pgvector settings are applied through parameter-safe SQL before the HNSW query
runs. The default semantic, keyword-first, and hybrid search paths remain
unchanged while the production parity harness rechecks speed and result quality.

---

## Problem Frame

The production parity run for PR 1407 showed apparent HNSW speed, but the
prototype returned zero results because the retriever failed before the real
query. Postgres rejected Prisma's tagged `$executeRaw` form for `SET LOCAL`
utility statements with placeholders, producing `syntax error at or near "$1"`.
The fix must keep the earlier security improvement of avoiding
`$executeRawUnsafe` while allowing the prototype query to reach the database.

---

## Requirements

- R1. The HNSW prototype must apply `hnsw.ef_search`,
  `hnsw.iterative_scan`, and `hnsw.max_scan_tuples` within the same transaction
  as the prototype query.
- R2. The implementation must avoid `$executeRawUnsafe` and avoid placeholder
  use in unsupported `SET LOCAL` utility statements.
- R3. The default `semantic-video` query and public search modes must remain
  behaviorally unchanged.
- R4. Focused tests must fail on the old `SET LOCAL $1` shape and prove the
  HNSW DB timing records the real prototype query.
- R5. After merge and deploy, production parity canaries must compare exact
  semantic and HNSW prototype result signatures plus timing.

---

## Key Technical Decisions

- **Use `set_config` instead of `SET LOCAL`:** PostgreSQL exposes
  `set_config(name, value, is_local)` as a normal expression, so Prisma can
  parameterize the setting name and value safely. Passing `true` for `is_local`
  preserves the transaction-local behavior that `SET LOCAL` was meant to give.
- **Keep the prototype internal-only:** This is a repair of the eval path, not a
  promotion of HNSW-first retrieval. Public modes and the default exact semantic
  retriever stay untouched.
- **Make tests inspect the setting calls:** The mock-Prisma tests should assert
  the first three transaction queries are `set_config` calls and the last query
  is the timed `semantic-video-hnsw.query` retrieval.

---

## Implementation Units

### U1. Replace failing `SET LOCAL` calls with transaction-local `set_config`

- **Goal:** Let the HNSW prototype apply pgvector settings safely and reach its
  retrieval SQL.
- **Requirements:** R1, R2, R3
- **Dependencies:** none
- **Files:**
  - `apps/admin/src/services/hybrid-search-retrievers.ts`
- **Approach:** Change the HNSW transaction setup to call parameterized
  `SELECT set_config(...)` statements before the existing timed raw query. Keep
  the existing prototype constants, transaction timeout, timing label, and SQL
  retrieval shape.
- **Patterns to follow:** Existing transaction-scoped HNSW setting intent in
  `searchVideoSemanticHnswPrototype`; existing DB timing wrapper in
  `recordSearchDbTiming`.
- **Test scenarios:**
  - The prototype transaction issues three `set_config` statements before the
    retrieval query.
  - The setting values match the existing HNSW constants.
  - `$executeRawUnsafe` and `SET LOCAL` are not used by the prototype.
- **Verification:** Focused retriever tests prove the transaction setup and
  timing label.

### U2. Update the HNSW retriever tests for the repaired query flow

- **Goal:** Catch this specific Prisma/Postgres utility-statement failure in
  future changes.
- **Requirements:** R2, R4
- **Dependencies:** U1
- **Files:**
  - `apps/admin/src/services/hybrid-search-retrievers.test.ts`
- **Approach:** Add a helper that mocks the three `set_config` calls before the
  final HNSW query result. Update the scan-knob test to inspect `set_config`
  query text and parameters instead of `$executeRaw`.
- **Patterns to follow:** Existing `latestRawSqlWithFragments` helpers and
  HNSW prototype SQL-shape assertions.
- **Test scenarios:**
  - The DB timing test still records one fulfilled
    `semantic-video-hnsw.query` timing for the retrieval query.
  - HNSW SQL-shape tests continue reading the final raw query, not the setting
    calls.
  - The scan-knob test proves all settings are local and parameterized.
- **Verification:** Focused retriever test suite passes.

### U3. Merge, deploy, and rerun production parity canaries

- **Goal:** Confirm whether the repaired HNSW prototype is a real speed
  improvement and whether results match the exact path closely enough to keep
  evaluating.
- **Requirements:** R3, R5
- **Dependencies:** U1, U2
- **Files:**
  - `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
  - `docs/solutions/performance-issues/admin-semantic-hnsw-prototype-parity-gate.md`
- **Approach:** Merge the fix after validation, wait for the Admin production
  deployment, rerun the existing parity script for `the bible project`,
  `jesus`, and `hope when life is hard`, and compare client timings, service
  timings, result counts, top result IDs, and parity flags against the failing
  run.
- **Patterns to follow:** Prior production HNSW parity run artifacts under
  `/tmp/prod-search-hnsw-parity-20260628*` and the roadmap's eval gate.
- **Test scenarios:** Test expectation: none -- this unit is operational
  validation after deploy rather than repo behavior.
- **Verification:** The final report includes deployment status, timing
  comparison, and result-parity outcome.

---

## Scope Boundaries

- Do not promote `semantic-hnsw-prototype` to a public or default search mode.
- Do not change ranking weights, row-window constants, RRF behavior, trace
  writes, or DB pool settings in this fix.
- Do not treat faster zero-result failure as a speed win; only successful HNSW
  retrievals count.

---

## Risks & Dependencies

- **Result-quality risk:** Once the prototype actually runs, it may still fail
  parity because HNSW-first windowing can reduce distinct videos.
- **Planner risk:** A successful query does not prove the HNSW index is chosen;
  production `EXPLAIN` remains a separate promotion gate.
- **Deployment dependency:** The parity rerun depends on the Admin production
  deployment completing after merge.

---

## Sources & Research

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/plans/2026-06-28-001-perf-admin-search-hnsw-prototype-plan.md`
- `docs/solutions/performance-issues/admin-semantic-hnsw-prototype-parity-gate.md`
- `docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md`
