---
id: "feat-177"
title: "Agent login handles"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 5
depends_on:
  - "feat-121"
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "ai-pipeline"
---

## Problem

AI agents need to perform browser-based validation against local and preview
Forge apps that use Production Auth. App-local bypasses skip the real Auth
journey, while static shared test passwords create credential-management and
inbox-verification friction.

Add an Auth-owned way for trusted developer environments to mint short-lived,
email-like agent login handles. Agents paste the handle into the existing
Auth email field, click Continue, and Auth redeems it into the normal
OAuth/app-local session flow for approved local or preview clients.

## Entry Points - Read These First

1. `docs/brainstorms/2026-06-11-agent-login-flow-requirements.md` - product
   decisions and scope boundaries.
2. `docs/plans/2026-06-11-001-feat-agent-login-handles-plan.md` -
   implementation plan.
3. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md` - Auth package boundaries
   and validation.
4. `apps/auth/src/app/api/auth/[...all]/route.ts` - login-method and sign-in
   route wrapper.
5. `apps/auth/src/app/login/login-page-client.tsx` - email-first Continue UI.
6. `apps/auth/prisma/schema.prisma` - Auth users, sessions, app registry,
   tokens, and audit models.
7. `apps/auth/src/domain/apps.ts` - local/preview/production OAuth clients and
   default scopes.
8. `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`
   - credential storage decision matrix.
9. `docs/solutions/security-issues/pre-verification-log-field-namespace-pollution-20260518.md`
   - pre-verification logging discipline.

## Grep These

- `login-method` in `apps/auth/src/app/api/auth/[...all]/route.ts`
- `LoginStep` in `apps/auth/src/app/login/login-page-client.tsx`
- `model User|model TokenRecord|model AuthAuditEvent` in
  `apps/auth/prisma/schema.prisma`
- `isExactRedirectUriAllowed|validateAppEnvironmentPolicy` in
  `apps/auth/src/services/app-registry.service.ts`
- `buildAuditEvent|redactAuditMetadata` in `apps/auth/src/services/audit.service.ts`

## What To Build

1. Add Auth-owned persistence for Agent identity classification and generic
   user expiry.
2. Add a protected minting API for trusted developer environments. The API
   validates an environment-provided minting key, client, redirect URI, app
   environment, and requested scopes before returning an email-like handle.
3. Extend the existing email-first login-method flow so valid agent handles
   redeem directly without routing to password entry or email validation.
4. Create normal Auth browser sessions and continue the existing OAuth callback
   flow for local/preview clients.
5. Add audit/operator visibility that distinguishes Agent activity from human
   users and never logs raw handles or minting keys.
6. Document local developer usage and provide a thin helper script for minting
   handles for Admin, Manager, and Mastra Studio QA.

## Constraints

- Do not add app-local auth bypasses to Admin, Manager, Mastra Gateway, or Web.
- Do not allow production relying-client callback redemption in the first slice.
- Do not expose public signup or public handle minting.
- Do not require static shared passwords or inbox-backed email accounts.
- Do not make Auth own app-specific ABAC or domain permissions.
- Do not log raw minted handles, minting keys, bearer tokens, refresh tokens,
  passwords, client secrets, or unnecessary PII.

## Verification

- A trusted developer environment can mint a scoped handle for local Admin,
  Manager, or Mastra Studio.
- A browser-driving agent can paste the handle into Auth's email field, click
  Continue, and return to the relying app with a normal app-local session.
- Normal human email/password and social login flows continue to work.
- Expired, production-client, mismatched-scope, and double-redeemed handles fail
  closed.
- Audit records distinguish mint success/failure and redeem success/failure
  without raw handles or raw minting keys.
- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`

## Progress Notes

- Implemented Agent users with `actorType` and generic `expiresAt` in Auth,
  including generated Prisma client updates and migration
  `0002_agent_login_users`.
- Added the protected mint API, mint helper script, and docs for developer
  environment provisioning.
- Extended the email-first login flow so a valid handle entered into the
  existing email box redeems through a Better Auth plugin endpoint into a normal
  browser session and OAuth continuation.
- Added audit events, actor type claims, and dashboard actor labels for agent
  visibility without logging raw handles or keys.
- Verified with `pnpm --filter @forge/auth typecheck`,
  `pnpm --filter @forge/auth lint`, and `pnpm --filter @forge/auth test`.
