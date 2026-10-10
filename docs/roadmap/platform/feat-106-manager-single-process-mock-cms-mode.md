---
id: "feat-106"
title: "Manager Single-Process Mock CMS Mode"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-22"
duration: 5
depends_on: []
blocks: []
tags:
  - "manager"
  - "cms"
  - "infrastructure"
---

## Problem

`apps/manager` is intentionally coupled to Strapi today for auth, GraphQL reads, REST read models, and durable job/automation state. That is correct for production, but it blocks a simple cloud-hosted preview/demo/QA deployment where Manager should run as a single Railway/Next.js process without a separate CMS service. We need an explicit non-production mock mode that preserves honest Manager behavior without pretending to be canonical CMS.

## Entry Points — Read These First

1. `apps/manager/src/config/env.ts` — current `STRAPI_*` env requirements that block standalone boot.
2. `apps/manager/src/lib/auth.ts` — Strapi-backed login/session verification boundary.
3. `apps/manager/src/app/api/auth/login/route.ts` — current `/api/auth/local` login path.
4. `apps/manager/src/cms/client.ts` — Apollo client pointed directly at `${STRAPI_URL}/graphql`.
5. `apps/manager/src/services/cmsClient.ts` — shared REST client for CMS reads/writes.
6. `apps/manager/src/lib/state.ts` — Strapi-backed `EnrichmentJob` persistence and read/update helpers.
7. `apps/manager/src/app/api/videos/route.ts` and `src/app/api/languages/route.ts` — narrow manager-critical read models already separated from generic GraphQL.
8. `apps/manager/src/features/agents/automation-store.ts` and `src/features/agents/automation-runner.ts` — automation state plus read-only selection vs mutation boundary.
9. `apps/manager/src/features/jobs/review-player/load-job-review-context.ts` — review-source loading that currently assumes CMS-backed video data.
10. `apps/manager/railway.toml` — existing single-process standalone deployment shape that mock mode must preserve.
11. `docs/solutions/platform/optional-railway-s3-local-fallback.md` — accepted env-gated local fallback pattern.
12. `docs/solutions/integration-issues/manager-automation-dry-run-report-boundary-20260413.md` — precedent for branching before live writes while keeping read logic honest.

## Grep These

- `STRAPI_URL|STRAPI_API_TOKEN|STRAPI_INTERNAL_API_TOKEN|MANAGER_API_KEY` in `apps/manager/src/`
- `strapi-jwt|/api/auth/local|/api/users/me|populate=role` in `apps/manager/src/`
- `getClient\\(|cmsGet\\(|cmsPost\\(` in `apps/manager/src/`
- `/api/video-coverage|/api/language-geo|/api/video-coverage/automation-candidates` in `apps/manager/src/`
- `enrichmentJob|enrichmentAutomation|enrichmentAutomationRun` in `apps/manager/src/`
- `writeArtifact|readArtifact|.tmp` in `apps/manager/src/`
- `buildCommand|startCommand|standalone` in `apps/manager/railway.toml`

## What To Build

1. Add an explicit Manager data mode switch, with `live` preserving today's Strapi-backed behavior and `mock` enabling standalone preview/demo boot without `STRAPI_*`.
2. Introduce a manager-owned data gateway with two adapters:
   - live adapter wrapping the current Strapi auth, GraphQL, and REST behavior
   - mock adapter serving only the exact Manager-facing shapes needed by current routes/pages
3. Replace direct Manager dependencies on Strapi transport helpers with gateway reads/writes for:
   - auth/session verification
   - language geo
   - video coverage
   - coverage snapshots
   - job list/detail state
   - automation list/detail/run state
   - review-player video/subtitle source data
4. In mock mode, seed typed fixture data plus a writable `.tmp` store so login, coverage, jobs, agents, and demo job creation work inside one process.
5. Keep mock mode honest:
   - do not emulate all of Strapi
   - do not expose a fake generic `/graphql` server
   - do not perform canonical CMS, Mux, or embedding-index writes in mock mode
6. Reuse Manager's existing local artifact fallback for demo artifacts and review-player assets where possible.
7. Require Red/Green TDD around the new seam plus a user smoke test against the built standalone Manager runtime.

## Constraints

- Do not change production `live` behavior beyond routing existing callsites through the new gateway seam.
- Do not reintroduce file-backed state as production truth; mock mode must be explicitly non-production.
- Do not add CMS schema changes or GraphQL/codegen churn in V1. This mode should live entirely inside `apps/manager`.
- Do not build a general Strapi emulator. Support only the read/write surfaces Manager actually needs today.
- Do not let mock mode silently hit real Mux/OpenRouter/CMS writer paths.
- Do not rely on `/api/health` alone as verification; smoke real Manager routes and flows.

## Verification

- `MANAGER_DATA_MODE=mock` boots `apps/manager` without `STRAPI_URL`, `STRAPI_API_TOKEN`, or `STRAPI_INTERNAL_API_TOKEN`.
- The built standalone runtime starts with the existing Railway-style command and serves the login/dashboard successfully.
- Mock login succeeds with the seeded Manager user and protects dashboard routes correctly.
- `/api/videos`, `/api/languages`, `/api/coverage-snapshots`, jobs pages, and agents pages all load from mock mode without Strapi.
- Creating a demo job in mock mode creates a visible job record, survives refresh within the running process, and does not call CMS writer or Mux mutation paths.
- Focused red/green tests cover gateway selection, mock auth, mock reads, and mock mutation suppression.
- PR validation includes `pnpm --filter @forge/manager test`, `pnpm --filter @forge/manager lint`, `pnpm --filter @forge/manager typecheck`, a standalone build, and a user smoke test.
