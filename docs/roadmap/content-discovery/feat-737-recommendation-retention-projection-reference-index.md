---
id: "feat-737"
title: "Index profile projection run references for retention"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: ["feat-735"]
blocks: ["feat-738"]
tags: [recommendations, retention, postgres, reliability]
---

## Problem

After the outcome indexes deployed, retention reached profile generation deletion
and exhausted a 2,192 ms transaction budget. The full recommendation FK audit
identified an unindexed `recommendation_profile_projection_run.projection_id`.
A production read scanned 71,122 runs (35 MB) in approximately 27 ms to prove
that one generation had no references. The `ON DELETE SET NULL` FK repeats that
lookup for every deleted generation in the 100-parent page.

## Entry Points — Read These First

- `apps/admin/prisma/schema.prisma`: `RecommendationProfileProjectionRun`
- `apps/admin/src/services/recommendations/retention.service.ts`: `expiredGenerationPage`
- `apps/admin/src/services/recommendations/migration.operations.db.test.ts`

## Grep These

- `recommendation_profile_projection_run_projection_fkey`
- `recommendationProfileProjectionGeneration.deleteMany`

## What To Build

- Add a bounded transactional index migration and matching Prisma declaration.
- Cover empty reference lookups and real `SET NULL` behavior against 100,000 unrelated runs.
- Verify migration application, indexed production plans and natural cleanup progress.

## Constraints

- Preserve expiry, atomicity, five-second run deadline and serving health gate.
- Keep completed workflow runs when their generation is erased.
- Use normal PR-to-main deployment; no manual production purge.

## Verification

- Regression fails before the index and passes after it; 100 generation deletions
  preserve unrelated run links and detach linked completed runs.
- Focused tests, migration deployment, Prisma validation, TypeScript, lint and formatting.
- Live migration/index state, cleanup ledger and public delivery health after deployment.

## Resolution

Migration 0160 and the Prisma declaration add the projection reference index.
The regression reproduces the scan without it and passes with it: 100 generation
erasures complete under a 1.5-second statement deadline, 100,000 unrelated run
links survive, and two completed runs retain their state with cleared references.
All 63 focused migration/retention/profile-tail tests pass, along with migration
deployment, Prisma validation, focused TypeScript, ESLint and formatting.
Production verification will be recorded on the PR; accumulated overdue records
must still drain before the recommendation health gate reopens.
