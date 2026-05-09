---
id: "feat-120"
title: "Manager Admin Backend Migration"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-05-06"
duration: 14
depends_on:
  - "feat-086"
blocks: []
tags:
  - "manager"
  - "admin"
  - "cms"
  - "graphql"
  - "auth"
  - "migration"
---

## Problem

`apps/manager` still treats Strapi as its production backend for login, role
checks, language and coverage read models, coverage snapshots, job state, and
some enrichment writeback paths. `apps/admin` is now the strategic Strapi
replacement and already owns a real GraphQL + Prisma + Better Auth platform,
Core-synced video/reference data, media workflows, and embedding backfills.
Manager needs a planned migration from Strapi endpoints and Strapi GraphQL to
Admin-owned contracts so Strapi can be retired without breaking Manager.

## Entry Points — Read These First

1. `docs/plans/2026-05-06-001-feat-manager-admin-backend-migration-plan.md` — implementation plan for this ticket.
2. `apps/manager/AGENTS.md` — Manager package guide; note `src/cms/gateway.ts` is the current boundary.
3. `apps/manager/CLAUDE.md` — current Manager Strapi dependencies and existing admin embed trigger proxy.
4. `apps/admin/AGENTS.md` — Admin architecture rules and Strapi-replacement stage.
5. `apps/admin/CLAUDE.md` — current Admin build status, Better Auth, Core sync, workflow, and manager-artifact contracts.
6. `apps/manager/src/config/env.ts` — current `STRAPI_*`, `MANAGER_DATA_MODE`, and `ADMIN_*` env surface.
7. `apps/manager/src/lib/auth.ts` — Strapi Users & Permissions login/session validation.
8. `apps/manager/src/cms/client.ts` — Apollo client pointed at Strapi GraphQL.
9. `apps/manager/src/services/cmsClient.ts` — Strapi REST helper used by backfill and embedding sync services.
10. `apps/manager/src/lib/state.ts` — Strapi-backed enrichment job persistence.
11. `apps/manager/src/app/api/videos/cache.ts` — Strapi `/api/video-coverage` dependency.
12. `apps/manager/src/app/api/languages/cache.ts` — Strapi `/api/language-geo` dependency.
13. `apps/manager/src/app/api/coverage-snapshots/cache.ts` — Strapi GraphQL coverage snapshot dependency.
14. `apps/admin/src/graphql/types/video.ts` and `apps/admin/src/services/video.service.ts` — current Admin video read surface.
15. `apps/admin/src/auth/session.ts`, `src/auth/permissions.ts`, and `src/graphql/context.ts` — Admin Better Auth and request principal model.

## Grep These

```
rg -n "STRAPI_URL|STRAPI_API_TOKEN|STRAPI_INTERNAL_API_TOKEN|strapi-jwt|/api/auth/local|/api/users/me" apps/manager/src apps/manager/.env.example apps/manager/CLAUDE.md
rg -n "getClient\\(|cmsGet\\(|cmsPost\\(|@forge/graphql" apps/manager/src
rg -n "video-coverage|language-geo|coverageSnapshots|EnrichmentJob|cms_notify|cms_sync" apps/manager/src apps/manager/CLAUDE.md
rg -n "ADMIN_GRAPHQL_URL|ADMIN_EMBED_TRIGGER_API_KEY|WORKFLOW_TRIGGER|WORKFLOW_API_KEYS" apps/manager/src apps/admin/src apps/admin/CLAUDE.md
rg -n "builder.queryFields|builder.mutationFields|hasPermission|read:videos|write:videos|UserRole" apps/admin/src apps/admin/prisma/schema.prisma
```

## What To Build

1. Add explicit Admin-backed Manager contracts in `apps/admin` for:
   - Manager session validation and Manager access permission.
   - Manager language geography read model.
   - Manager video coverage read model with language filtering.
   - Manager coverage snapshot read/range model.
   - Manager enrichment job state read/write model.
   - Manager enrichment artifact/embedding handoff where Manager currently posts back to CMS.
2. Replace Manager's Strapi transport with an Admin backend adapter while
   keeping Manager's browser-facing API routes stable.
3. Preserve Manager mock mode as a non-production adapter and keep it honest
   against the new Admin-shaped contracts.
4. Rename production-facing env, docs, cookies, and workflow step labels away
   from Strapi/CMS once the Admin adapter is verified.
5. Keep Admin as the data owner and Manager as the operator/workflow app for
   this slice; do not import Admin runtime code into Manager or vice versa.

## Constraints

- Do not let Manager call Admin's Prisma/database directly.
- Do not import runtime code across `apps/admin` and `apps/manager`.
- Do not keep Strapi as a hidden fallback in production once the Admin adapter is cut over.
- Do not remove Manager mock mode; update it so local demos still run without Admin.
- Do not pretend Admin already has every Manager-shaped contract. Add missing Admin contracts first, then switch Manager.
- Do not change Manager's frontend route shapes unless a plan unit explicitly calls it out.
- Do not use `@forge/graphql` for Admin contracts; that package is generated from Strapi schema.

## Verification

- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- Admin GraphQL contract smoke proves Manager can authenticate to Admin, list languages, fetch video coverage with two different `languageIds`, read snapshot ranges, create/update/list one enrichment job, and trigger the existing admin embedding workflow.
- Manager browser smoke proves login, Coverage, language filter changes, Jobs list/detail, job creation, and admin-embed trigger routes work with `MANAGER_BACKEND_MODE=admin` and no `STRAPI_*` env vars.

## Manager Membership Rollout Note

Manager panel access is explicit membership, not Admin editorial role. Deploy
Admin first, run the Prisma migration, grant the stage operator with:

```
pnpm --filter @forge/admin manager:grant-operator <admin-email>
```

Then deploy Manager in `MANAGER_BACKEND_MODE=admin`. A registered Admin user
without `ManagerMembership.OPERATOR` must be denied Manager login.
