---
id: "feat-451"
title: "Watch search candidate exact compatibility identities"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-03"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "graphql"
---

## Problem

Watch Search candidate generations, qualification evidence, evaluation leases,
and serving diagnostics need to bind to exact compatibility identities instead
of drifting with routine current-contract projection changes. The migration and
service layer must preserve rolling-deploy safety while rejecting stale
evidence when the physical compatibility tuple changes.

## Entry Points — Read These First

1. `apps/admin/prisma/migrations/0073_watch_search_candidate_exact_compatibility_identities/migration.sql` — exact-identity columns, legacy backfill, and trigger repair.
2. `apps/admin/prisma/schema.prisma` — rolling-safe Prisma field rename that keeps the physical `application_revision` column.
3. `apps/admin/src/services/typesense-watch-search-candidate-generation.ts` — generation identity persistence and stale-generation rejection.
4. `apps/admin/src/services/typesense-watch-search-profile.ts` — profile freezing, resolution, and exact-identity comparisons.
5. `apps/admin/src/services/typesense-watch-search-candidate-evaluation.service.ts` — evaluation lease admission and diagnostics identity checks.
6. `apps/admin/src/services/typesense-watch-search.service.ts` and `apps/admin/src/services/search-trace.service.ts` — serving admission plus projection-vs-evaluated trace provenance.
7. `apps/admin/src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts` and related `*.test.ts` files — migration and regression coverage.

## Grep These

- `indexContractRevision`
- `contentEmbeddingContractId`
- `transcriptChunkingVersion`
- `application_revision`
- `candidateWatchSearchIndexContractRevision`
- `watch search candidate compatibility backfill`

## What To Build

- Rename the code-facing compatibility vocabulary to Watch Search Index Contract
  Revision and `indexContractRevision` while keeping the physical
  `application_revision` column unchanged.
- Persist the exact content embedding contract id and transcript chunking
  version for candidate generations, qualification evidence, and evaluation
  leases.
- Reject stale qualification, evaluation, promotion, and serving state when
  the exact compatibility tuple changes, while allowing routine transcript
  projection revision changes to keep qualified current serving resolvable.
- Keep migration deploys safe for both fresh databases and legacy databases
  that already contain candidate rows requiring backfill.

## Constraints

- Do not rename the physical `application_revision` database column.
- Do not relax exact compatibility checks back to loose provider/model/dimension
  matching.
- Do not skip or weaken the migration backfill failure when legacy rows really
  need an exact compatibility identity.
- Do not hand-edit generated GraphQL artifacts.

## Verification

```bash
pnpm --filter @forge/admin test -- src/scripts/prisma-migration-deploy-safety.test.ts src/services/typesense-watch-search-candidate-trigger-migration.db.test.ts
pnpm --filter @forge/admin typecheck
pnpm prettier --check docs/roadmap/content-discovery/feat-451-watch-search-candidate-exact-compatibility-identities.md
```
