---
id: "feat-591"
title: "Run Co-watch PostgreSQL regressions in CI"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-10-01"
duration: 1
depends_on: []
blocks: []
tags: [admin, recommendations, cowatch, testing, ci]
---

## Problem

The Co-watch restoration retains native PostgreSQL regression tests that passed
locally, but the default test job skips them without explicit database setup.
The runtime fix shipped separately because the earlier GitHub credential could
not update workflows. The October 2 closeout explicitly authorizes this CI
work; it adds automation without changing production authority.

## Entry Points — Read These First

1. `.github/workflows/ci.yml` — `admin-schema-drift` PostgreSQL 18 service and
   existing recommendation native test steps.
2. `apps/admin/src/services/recommendations/cowatch/refresh.db.test.ts` and
   `apps/admin/src/services/recommendations/integrity.measurement-reuse.db.test.ts`
   — create isolated child databases from an owned `forge_test` parent.
3. `apps/admin/src/services/recommendations/cowatch/trial-authority.db.test.ts`
   and `source-query.db.test.ts` — current-schema `forge_feat565_test` fixture.
4. `docs/validation/cowatch-restoration-20261001/local-validation.md` — completed
   local proof: 52 tests across these four suites.

## Grep These

`RECOMMENDATION_DB_TEST|forge_test|forge_feat565_test|recommendationRuntimeMigrationSql`

## What To Build

- Create the two owned fixture databases through the CI PostgreSQL service.
- Run refresh and integrity-reuse tests with `RECOMMENDATION_DB_TEST=1` and
  `DATABASE_URL` pointing to `forge_test`.
- Apply the complete current migration chain to `forge_feat565_test`, then run
  trial-authority and source-query tests with the same opt-in flag.
- Use `--no-file-parallelism --testTimeout=30000` for both test commands; retain
  the fixtures' existing ownership, isolation and cleanup guards.

## Constraints

Use the existing authorized GitHub connection to update the workflow. Never
bypass required checks, use production data or credentials, alter native
assertions, or change runtime refresh policy.

## Verification

Run the exact proposed commands against PostgreSQL 18 and the current migration
chain locally, then confirm the PR's existing `admin-schema-drift` job executes
all four suites with no skipped native coverage. Keep the existing CI gate and
other recommendation integration checks intact.

## Closeout — October 2, 2026

- `admin-schema-drift` creates the two named fixture databases. Refresh and measurement reuse run on `forge_test`; current migrations are applied to `forge_feat565_test` before trial authority and source query run. Both commands retain serial file execution and a 30-second test timeout.
- Local PostgreSQL 18/pgvector runs passed all 52 native tests: 13 refresh, six measurement reuse, 32 trial authority and one source query. Each harness rejected an incorrectly named database before setup. Existing native assertions and runtime authority remain unchanged.
