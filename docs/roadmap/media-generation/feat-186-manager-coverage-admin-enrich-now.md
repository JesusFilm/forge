---
id: "feat-186"
title: "Manager coverage Admin Enrich Now"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-13"
duration: 1
depends_on:
  - "feat-031"
  - "feat-084"
  - "feat-184"
blocks:
  - "feat-188"
tags:
  - "manager"
  - "coverage"
  - "subtitle-enrichment"
  - "admin-read-model"
---

## Problem

The Manager Coverage dashboard now reads Admin-backed video and language IDs,
but `/api/enrich` still validates and creates jobs like the retired CMS/Core
path. Selecting English in production can send an Admin language document ID
such as `cmokkxw5v03uyqsccis58pea6`; the route rejects that ID before job
creation because `targetLanguageIds` still has a Core-era `max(10)` guard.
Even after relaxing that guard, admin mode returns the retired-CMS `410`
instead of creating enrichment jobs.

## Entry Points - Read These First

1. `docs/plans/2026-06-13-001-fix-manager-coverage-admin-enrich-now-plan.md`
   - implementation plan for this fix.
2. `apps/manager/src/app/api/enrich/route.ts`
   - failing route and job-creation flow.
3. `apps/manager/src/features/coverage/coverage-report-client.tsx`
   - `Enrich Now` payload and feedback display.
4. `apps/admin/src/services/manager-read-model.service.ts`
   - Admin-backed coverage/language read model source.
5. `apps/manager/src/services/stageClone.ts`
   - existing materialization policy that must be preserved.
6. `apps/manager/src/lib/admin-video-lookup.ts`
   - existing Manager to Admin lookup/error-envelope pattern.

## What To Build

- Make Admin's Manager language read model expose enough language metadata for
  Manager to resolve Admin language IDs into workflow language codes.
- Add a narrow Admin read model/query for selected coverage videos that returns
  the video variant metadata Manager already needs for enrichment
  materialization.
- Restore `/api/enrich` admin-mode job creation by resolving Admin IDs through
  Admin read models and preserving existing direct/stage-clone materialization.
- Keep mock mode behavior unchanged.
- Show a more specific coverage UI error when the route returns validation
  details or per-video errors.

## Verification

- `pnpm --filter @forge/admin run schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin test -- manager-read-model graphql/schema`
- `pnpm --filter @forge/manager test -- app/api/enrich backend/admin-client`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/admin-graphql typecheck`
- Helium/browser smoke on Manager Coverage selecting a missing subtitle tile
  and clicking `Enrich Now`.
