---
id: "feat-734"
title: "Restore recommendation retention with an indexed content-action cascade"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: ["feat-735"]
tags: [recommendations, retention, postgres, reliability]
---

## Problem

Production recommendation delivery returns `retention_overdue`. The last successful
retention run was 2026-10-14T16:04:37Z. Deleting standalone content actions repeatedly
exhausts the remaining transaction deadline: the eligibility FK has no leading
`content_action_id` index, so every parent deletion scans approximately 248,000
eligibility rows, even when none references a content action.

## Entry Points — Read These First

- `apps/admin/prisma/schema.prisma`: `RecommendationEligibilityDecision`
- `apps/admin/src/services/recommendations/retention.service.ts`: standalone action deletion
- `apps/admin/src/services/recommendations/migration.operations.db.test.ts`
- `docs/solutions/database-issues/recommendation-retention-request-child-count-20261004.md`

## What To Build

- Add a bounded, transactional migration indexing the complete `content_action_id` FK.
- Declare the index in Prisma and exercise the real cascade against 250,000 unrelated decisions.
- Preserve expiry, cascade semantics, the five-second run deadline and serving health gate.
- Merge through CI and verify the normal Admin deployment applies the index and retention recovers.

## Grep These

- `recommendation_eligibility_content_action_idx`
- `recommendationContentAction.deleteMany`
- `retention_overdue`

## Constraints

- Add only the missing index; retain existing expiry and cascade behavior.
- Bound migration lock wait and execution; use the normal PR-to-main deployment.
- Do not raise retention timeouts or disable recommendation health checks.

## Verification

- Real PostgreSQL regression: empty child lookup uses the index, 100 action deletions
  succeed, historical/current action decisions cascade, unrelated decisions survive.
- Clean migration deployment, focused retention tests, lint and formatting.
- Production: migration applied, index valid, fresh successful retention run, no
  expired backlog beyond the health allowance, public delivery no longer `retention_overdue`.

## Resolution

Migration 0158 and the Prisma declaration add the complete FK index. The new
PostgreSQL regression fails with a sequential scan before the migration and passes
after it, including 100 parent deletions under a 2.5-second statement deadline and
preservation of unrelated decisions. All 67 focused migration/retention tests pass;
the full migration history applies to a clean PostgreSQL 18 database. Deployment
and production recovery evidence will be recorded on the PR after merge.
