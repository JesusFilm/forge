---
id: "feat-129"
title: "Mastra Railway Workflow Runtime"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-22"
duration: 7
depends_on:
  - "feat-121"
blocks:
  - "feat-132"
  - "feat-169"
  - "feat-184"
tags:
  - "platform"
  - "manager"
  - "ai-pipeline"
  - "auth"
  - "infrastructure"
---

## Problem

Forge needs a shared agent and workflow runtime that apps such as Manager can
call for media operations like subtitle configuration, translation, retiming,
and future agent-driven workflows. The first Mastra deployment should prove
Railway hosting, Forge-owned Studio authentication, and service-bearer
app-to-runtime access before moving real Manager subtitle workloads onto the
runtime.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-22-mastra-railway-workflow-runtime-requirements.md`
   - chosen product shape, auth boundaries, and V1 scope.
2. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md` - Forge Auth app rules,
   OAuth/OIDC role, and Railway deployment notes.
3. `apps/auth/src/domain/apps.ts` - current first-party app registration seed
   pattern for admin and manager.
4. `apps/manager/AGENTS.md` and `apps/manager/CLAUDE.md` - Manager auth,
   workflow, service bearer, and Railway patterns.
5. `apps/manager/src/lib/auth.ts` - existing Manager session and service
   bearer authentication pattern.
6. `apps/manager/src/workflows/videoEnrichment.ts` and
   `apps/manager/src/services/subtitleTranslation/` - future subtitle workflow
   integration context; do not migrate this in the first slice.
7. `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` - new app
   env validation, lazy client, and Railway patterns.
8. `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md` -
   Railway monorepo deployment caveats.

## Grep These

- `AUTH_ISSUER_URL|AUTH_MANAGER_CLIENT_ID|MANAGER_SESSION_SECRET` in
  `apps/manager`
- `FIRST_PARTY_APP_SEEDS|MANAGER_APP_SEED|ADMIN_APP_SEED` in `apps/auth/src`
- `MANAGER_API_KEY|ADMIN_TRIGGER_API_KEYS|WORKFLOW_API_KEYS` in `apps/manager`
  and `apps/admin`
- `railway.toml|healthcheckPath|HOSTNAME=0.0.0.0` in `apps/*`
- `subtitleTranslation|runVideoEnrichment|WorkflowStepName` in
  `apps/manager/src`

## What To Build

1. Add a new Mastra runtime app/service that can deploy to Railway and expose a
   healthcheck plus one smoke-test agent or workflow.
2. Add a Forge-authenticated public entry point for Mastra Studio so authorized
   internal users can open Studio without relying on Mastra native production
   SSO/RBAC.
3. Gate Studio access with gateway-owned Mastra Studio access records so
   gateway admins can toggle who is allowed to administer Studio without
   changing Mastra-native auth or using `apps/admin`.
4. Add a simple `apps/mastra-gateway` `/admin` surface where gateway admins can
   approve access requests, revoke access, and assign admin/editor permission
   levels. Editors can access Studio but cannot manage access.
5. Protect app-to-Mastra calls with a V1 service-bearer contract. Manager or a
   scripted stand-in must be able to call the deployed runtime with
   `Authorization: Bearer <token>`.
6. Prevent direct unauthenticated browser/API access to the underlying Mastra
   service through Railway networking, edge controls, or Mastra-side bearer
   checks.
7. Document the env matrix, Railway service configuration, healthcheck, smoke
   commands, and production access model.
8. Leave actual Manager subtitle workflow migration for a follow-up ticket after
   the runtime and auth shape are proven.

## Constraints

- Do not migrate Manager subtitle workflows in this first slice.
- Do not make Mastra Studio the normal product UI for subtitle configuration;
  Manager remains the operator surface.
- Do not rely on Mastra native production SSO/RBAC for V1.
- Do not expose Studio or Mastra API routes publicly without Forge auth or
  service-bearer enforcement.
- Do not log raw bearer tokens, cookies, client secrets, model API keys, or
  unnecessary PII.

## Verification

- Authorized Forge user can open the protected Studio entry point on Railway.
- Forge users without the gateway-owned Mastra Studio access grant cannot open the
  Studio entry point.
- Revoking the Mastra Studio access grant prevents future Studio access.
- Gateway admins can approve a pending access request and assign admin/editor
  permission levels.
- Gateway editors can access Studio but cannot manage users or access requests.
- Unauthenticated browser requests cannot reach Studio through the public entry
  point.
- Wrong or missing service bearer cannot invoke the Mastra smoke-test API.
- Correct service bearer can run the smoke-test agent/workflow against the
  deployed Railway runtime.
- Studio can observe or inspect the deployed smoke-test run.
- `pnpm --filter <new-mastra-package> lint`
- `pnpm --filter <new-mastra-package> typecheck`
- Any gateway app tests for auth/proxy behavior pass.
