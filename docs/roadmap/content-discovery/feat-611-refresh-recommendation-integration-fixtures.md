---
id: "feat-611"
title: "Refresh stale recommendation integration test fixtures"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-10-01"
duration: 1
depends_on: []
blocks: []
tags: [admin, recommendations, testing]
---

## Problem

Renumbered from feat-590 to preserve the approved precomputed recommendation
experiment. Earlier assignments of feat-607 and feat-609 were superseded by
feat-611 on October 6, 2026 as concurrent main changes allocated those IDs to
media-generation and HNSW-recall work. The completed fixture work and its
acceptance evidence are unchanged.

The feat-589 broader PostgreSQL check exposed two pre-existing fixture failures on main `374897333`. They are separate from the delivery repair; neither failing fixture or runtime path was changed there. Do not weaken production expiry or owner authority to make fixtures pass.

## Entry Points — Read These First

1. `apps/admin/src/services/recommendations/migration.playback-upgrade.db.test.ts:43` fixes `expiresAt` at September 17, 2026 but inserts a request with default current `created_at`. After that date, `recommendation_request_expiry_check` rejects setup. Preserve the historical migration chain but make its fixture timestamps internally consistent.
2. `apps/admin/src/services/recommendations/viewing-mode.service.db.test.ts:60` manually loads migrations only through 0104. Current `viewing-mode.service.ts` owner-authority filtering expects `recommendation_request.owner_release_id`; the runtime-backed fixture lacks that column. Prefer the existing `current-schema.test-fixture.ts` convention where applicable.
3. `.github/workflows/ci.yml` defines purpose-specific database test groups. A single `RECOMMENDATION_DB_TEST=1` run over every file is not a valid universal harness: some destructive/manual suites explicitly require distinct owned database names.

## Grep These

`expiresAt =|recommendation_request_expiry_check|owner_request.owner_release_id|recommendationRuntimeMigrationSql`.

## What To Build

- Make the historical playback-upgrade fixture independent of wall-clock date without changing migration semantics.
- Refresh the viewing-mode runtime fixture schema while retaining real owner-influence assertions.
- Keep named-database safety guards; document or use the appropriate owned local fixture for each suite.

## Verification

Run both named test files against an owned loopback PostgreSQL/pgvector database with `RECOMMENDATION_DB_TEST=1`; exercise dates beyond September 17. Confirm production expiry checks and owner-release filters remain unchanged. Run Admin typecheck and scoped lint/format.

## Closeout — October 2, 2026

- The historical playback-upgrade test sets request and item creation timestamps before its fixed September 17 expiry. Its original migration chain and the production expiry constraint are unchanged.
- The viewing-mode runtime test loads the current recommendation schema, including owner-release authority. The shared schema fixture executes migration 0127's lock, run update and truncation against its isolated schema; it does not skip the migration or alter production SQL. This also restores the current deterministic delivery/fallback fixture.
- PostgreSQL 18/pgvector: four tests in the two named suites passed after the historical expiry date. The current last-known-good fallback drill passed against PostgreSQL and Redis with a freshly generated Prisma client. Admin typecheck, scoped ESLint and Prettier passed.
