---
id: "feat-591"
title: "Run Co-watch PostgreSQL regressions in CI"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-10-01"
duration: 1
depends_on: []
blocks: []
tags: [admin, recommendations, cowatch, testing, ci]
---

## Problem

The Co-watch restoration retains native PostgreSQL regression tests that passed
locally, but the default test job skips them without explicit database setup.
The owner requested deferring CI workflow changes so the runtime fix can ship
with the existing GitHub credential permissions. This follow-up adds automation
without changing production authority or blocking feat-565/feat-573 release.

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

Use a GitHub credential already authorized to update workflows, or obtain the
owner's authorization for that scope. Never bypass required checks, use production
data or credentials, alter native assertions, or change runtime refresh policy.

## Verification

Run the exact proposed commands against PostgreSQL 18 and the current migration
chain locally, then confirm the PR's existing `admin-schema-drift` job executes
all four suites with no skipped native coverage. Keep the existing CI gate and
other recommendation integration checks intact.
