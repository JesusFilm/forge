---
id: "feat-735"
title: "Index both co-watch outcome cascades for retention"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: ["feat-734"]
blocks: []
tags: [recommendations, retention, postgres, reliability]
---

## Problem

After feat-734 deployed, retention deleted 100 previously blocked content actions
and 50 requests, then timed out in the next request deletion. An inbound FK audit
found missing leading indexes on both outcome references in
`recommendation_cowatch_contribution` (234,653 rows, 141 MB). A bounded production
read found no children but spent about 18 ms on the source lookup and 40 ms on the
target lookup. Cascading outcome deletion repeats both lookups per parent.

## Entry Points — Read These First

- `apps/admin/prisma/schema.prisma`: `RecommendationCowatchContribution`
- `apps/admin/prisma/migrations/0104_recommendation_cowatch_shadow/migration.sql`
- `apps/admin/src/services/recommendations/migration.operations.db.test.ts`
- `apps/admin/src/services/recommendations/retention.service.ts`

## Grep These

- `source_outcome_id`
- `target_outcome_id`
- `recommendationRequest.deleteMany`

## What To Build

- Add migration-owned indexes for each outcome FK and matching Prisma declarations.
- Test both empty lookups and actual source/target cascades with 250,000 unrelated
  contributions across multiple generations.
- Verify normal production deployment and natural retention progress after merge.

## Constraints

- Preserve the five-second deadline, atomic cascade semantics and serving health gate.
- The existing generation-leading unique index does not bound either outcome lookup.
- Keep the migration transactional with bounded lock wait and execution.
- No direct production purge or deployment of local worktree code.

## Verification

- Regression fails without the indexes and passes with them; unrelated contributions survive.
- Full migration deployment, focused retention tests, type check, lint and formatting.
- Production index validity, query plans, natural cleanup results and public delivery health.

## Resolution

Migration 0159 and matching Prisma declarations index both outcome endpoints.
The new regression fails without those indexes and passes with them, including
100 outcome deletions under a 1.5-second statement deadline while 250,000 unrelated
contributions survive. All 68 focused migration/retention tests pass. Migration
deployment, Prisma validation, focused TypeScript, ESLint and formatting pass.
Production deployment and backlog recovery evidence will be recorded on the PR.
