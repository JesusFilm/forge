---
title: Admin Worker Standalone Workflow Startup - Plan
type: fix
date: 2026-07-09
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Admin Worker Standalone Workflow Startup - Plan

## Goal Capsule

- **Objective:** Restore the production `@forge/admin/worker` Railway deployment by ensuring the standalone Admin bundle contains the workflow instrumentation module required at startup.
- **Authority:** Production Railway logs and the Admin deployment contract override local assumptions. Keep the fix scoped to packaging/runtime startup unless validation proves a code-level workflow import change is required.
- **Execution profile:** Lightweight production hotfix.
- **Stop conditions:** Stop if the fix requires changing Admin workflow behavior, database schema, or the recent MediaCollection `coreId` feature.

## Product Contract

### Summary

The production `@forge/admin/worker` deployment for commit `612e7b2b1456` failed healthcheck after a successful build because startup could not import `instrumentation-workflow` from the standalone bundle.

### Problem Frame

Railway build logs show `@forge/admin` builds, pushes an image, runs migrations, starts Next, and then crashes with `ERR_MODULE_NOT_FOUND` for `.next/standalone/apps/admin/.next/server/chunks/instrumentation-workflow`.
Stage succeeded on the same commit, CI succeeded, and the production service crash is isolated to the worker startup path.

### Requirements

- R1. The Admin standalone runtime must include the server chunk or module needed by `src/instrumentation.ts` to import `./instrumentation-workflow`.
- R2. The Railway production build command must remain compatible with the existing `output: "standalone"` start command.
- R3. The hotfix must not alter workflow scheduling behavior, Prisma migrations, or GraphQL schema output.
- R4. Validation must prove the standalone output can resolve the workflow instrumentation import before the PR is merged.

## Planning Contract

### Key Technical Decisions

- KTD1. Treat this as a packaging defect first. The runtime code already gates workflow startup through `WORKFLOW_RUNNER_ENABLED` and `WORKFLOW_TARGET_WORLD`; the crash occurs because the module referenced by the standalone server chunk is absent.
- KTD2. Prefer copying the generated workflow instrumentation server artifact into the standalone output over disabling instrumentation or changing workflow startup behavior.
- KTD3. Keep the build command explicit in `apps/admin/railway.toml` because Railway config-as-code is already the documented deployment contract for Admin.

### Scope Boundaries

- In scope: `apps/admin/railway.toml`, optional small helper script if shell copying becomes too brittle, and deployment documentation that records the packaging invariant.
- Out of scope: workflow runtime behavior changes, database changes, Admin GraphQL schema changes, and yt-video-mapper indexing restart.

### Sources & Research

- Production Railway build/deploy logs for deployment `5370252675` show the missing `instrumentation-workflow` module and healthcheck failure.
- `apps/admin/railway.toml` currently copies only `.next/static` into `.next/standalone/apps/admin/.next/static`.
- `apps/admin/src/instrumentation.ts` dynamically imports `./instrumentation-workflow` for Node runtime workflow startup.
- `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md` documents that standalone Railway deployments need explicit runtime artifact copying.

## Implementation Units

### U1. Package Workflow Instrumentation With Admin Standalone Output

- **Goal:** Ensure the generated workflow instrumentation module is present at the path the standalone Admin server imports at runtime.
- **Requirements:** R1, R2, R3.
- **Files:** `apps/admin/railway.toml`; optional `apps/admin/scripts/*` or `apps/admin/src/scripts/*` helper only if direct shell copying is unsafe.
- **Approach:** Build locally after regenerating Prisma, inspect `.next/server` and `.next/standalone/apps/admin/.next/server` for `instrumentation-workflow`, then update the production build packaging step to copy the missing artifact into the standalone tree. Keep the command deterministic and fail-fast if the expected artifact is absent.
- **Patterns to follow:** Existing Admin Railway config-as-code and the standalone static-copy pattern in `apps/admin/railway.toml`.
- **Test scenarios:** Build Admin with production-like postinstall/generated Prisma state; assert the standalone tree contains the workflow instrumentation artifact; assert `node apps/admin/.next/standalone/apps/admin/server.js` no longer fails immediately with `ERR_MODULE_NOT_FOUND` when workflow startup is enabled enough to load instrumentation.
- **Verification:** Local command output demonstrates the generated standalone bundle resolves the workflow instrumentation import.

### U2. Validate Railway-Facing Healthcheck Path

- **Goal:** Prove the hotfix addresses the observed production failure mode before merge.
- **Requirements:** R4.
- **Files:** `apps/admin/railway.toml`; deployment logs after PR merge.
- **Approach:** Run the focused Admin build locally, inspect the standalone output, then after merge verify Railway production deploy for `@forge/admin/worker` reaches healthy status. If production still fails, capture the new first fatal error before making another code change.
- **Patterns to follow:** Existing Railway deployment monitoring workflow and GitHub deployment status checks.
- **Test scenarios:** Production deploy status changes from failure to success; `/api/health` healthcheck passes within the configured retry window; no new migration or schema drift is introduced.
- **Verification:** GitHub deployment status and Railway service status show `@forge/admin/worker` online on the hotfix commit.

## Verification Contract

| Gate                      | Scope                            | Done signal                                                                                           |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Admin Prisma generation   | `apps/admin`                     | `pnpm --filter @forge/admin exec prisma generate` completes successfully.                             |
| Admin production build    | `apps/admin`                     | `pnpm --filter @forge/admin build` completes successfully after the packaging change.                 |
| Standalone artifact check | `apps/admin/.next/standalone`    | The workflow instrumentation artifact exists at the runtime import path or the server can resolve it. |
| Railway deployment        | Production `@forge/admin/worker` | Latest deployment reaches `success` and service status is online.                                     |

## Definition of Done

- U1 and U2 are complete.
- The production `@forge/admin/worker` deployment no longer fails with missing `instrumentation-workflow`.
- CI remains green for the hotfix PR.
- A solution note records the standalone workflow instrumentation packaging lesson.
