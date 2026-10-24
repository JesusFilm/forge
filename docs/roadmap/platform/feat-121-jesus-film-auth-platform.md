---
id: "feat-121"
title: "Jesus Film Auth Platform"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-05-11"
duration: 14
depends_on:
  - "feat-105"
blocks:
  - "feat-100"
  - "feat-125"
  - "feat-133"
  - "feat-177"
  - "feat-322"
  - "feat-399"
  - "feat-401"
tags:
  - "platform"
  - "auth"
  - "sso"
  - "oauth"
  - "admin"
---

## Problem

Auth is currently embedded inside `apps/admin`, even though
`auth.jesusfilm.org` is intended to become the Jesus Film SSO authority. The
current approach relies on cross-subdomain cookie sharing between auth and
admin, which has not produced a reliable admin login path and does not model
admin as a proper OAuth/OIDC relying application.

Build a standalone Auth application/service that owns identity, global
membership, app registrations, app-level scopes/grants, OAuth/OIDC login, API
tokens, Firebase lazy migration, audit, and revocation. Migrate `apps/admin` as
the first relying client. Deploy `apps/auth` as its own Railway service and
move `auth.jesusfilm.org` to that service.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-11-jesus-film-auth-platform-requirements.md`
2. `docs/plans/2026-05-11-001-jesus-film-auth-platform-plan.md`
3. `apps/admin/src/auth/oauth-client.ts`
4. `apps/admin/src/app/api/auth/login/route.ts`
5. `apps/admin/src/app/api/auth/callback/route.ts`
6. `apps/admin/src/auth/session.ts`
7. `apps/admin/src/graphql/context.ts`
8. `apps/admin/prisma/schema.prisma`
9. `docs/solutions/auth/better-auth-secret-must-not-fallback-to-hardcoded-value.md`
10. `docs/solutions/auth/better-auth-firebase-migration-must-block-public-signup.md`

## Grep These

- `betterAuth|oauthProvider|genericOAuth|okta|nextCookies` in `apps/admin/src`
- `AUTH_ISSUER_URL|AUTH_ADMIN_CLIENT_ID` in `apps/admin`
- `resolvePrincipalFromRequest|requireSession|requireAdminSession` in `apps/admin/src`
- `PermissionKey|hasPermission|WORKFLOW_TRIGGER` in `apps/admin/src/auth`
- `model User|model Session|model Account|model Verification` in `apps/admin/prisma/schema.prisma`

## What To Build

1. Create a standalone Auth app/service with Better Auth as the identity
   authority and OAuth/OIDC provider for first-party clients.
2. Add an Auth-owned app registry with environments, redirect URLs, allowed
   origins, trust tier, approved scopes, and production approval posture.
3. Model global membership and app-level grants/scopes in Auth.
4. Support browser login sessions plus scoped OAuth access tokens for
   user-delegated calls and client-credentials service calls.
5. Migrate admin from embedded shared-cookie auth to an OAuth/OIDC relying
   client flow with admin-local session state.
6. Preserve admin-local permission and ABAC enforcement after migration.
7. Carry forward Firebase lazy migration safely without opening public signup.
8. Add operational surfaces for registered apps, grants, sessions, tokens,
   audit events, and emergency revocation.
9. Provision and document the standalone Railway service, database, migrations,
   healthcheck, runtime env vars, and custom domain for `apps/auth`.

## Constraints

- Do not rely on shared `.jesusfilm.org` cookies as the admin/Auth integration.
- Do not make Auth the owner of admin's fine-grained domain authorization.
- Do not build a public partner developer portal in the first slice.
- Do not expose public signup while preserving Firebase lazy migration.
- Do not log raw bearer tokens, refresh tokens, passwords, client secrets, or
  unnecessary PII.
- Local, staging, preview, and production must use the same conceptual OAuth
  consumer flow with environment-specific app registrations.
- `auth.jesusfilm.org` must be owned by the Auth Railway service after cutover,
  not by `apps/admin`.

## Verification

- Admin login redirects through Auth and returns with an admin-local session.
- Admin protected pages, GraphQL scope-auth gates, workflows, media surfaces,
  and admin-only settings still reject unauthenticated/under-scoped callers.
- Auth can deny admin access for a globally inactive user or a user lacking the
  admin app grant.
- Local/staging admin auth works through Auth app registrations without a
  Firebase dev/stage project.
- Service tokens are audience-bound, environment-bound, expiring, revocable,
  and audited.
- `apps/auth` is deployed on Railway with a dedicated database,
  migration/start command, healthcheck path, runtime env matrix, and
  `auth.jesusfilm.org` custom domain.
- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`

## Current Implementation Slice

Completed locally on 2026-05-11:

- `apps/auth` standalone Better Auth service scaffold, schema, migration,
  first-party seed script, login UI, Firebase lazy-migration bridge, trusted
  callback handling, public signup block, OAuth provider wrappers, scope/app
  policy services, token/audit models, Railway config, and operator dashboard.
- `apps/admin` OAuth relying-client flow, with PKCE/state, token exchange, JWT
  verification, admin-local signed session, and logout clearing.
- Repository-side cutover docs for Auth Railway deployment and admin OAuth envs.
- Railway production service `@forge/auth` provisioned on 2026-05-12 with a
  dedicated Postgres service, temporary Railway domain
  `https://forgeauth-production.up.railway.app`, migration/seed startup, and
  passing `/api/health`.
- `auth.jesusfilm.org` moved from `@forge/admin` to `@forge/auth`; Auth and
  admin production envs now point at the real Auth issuer.
- Existing admin SSO provider env values copied to Auth for Facebook, Google,
  and Okta. Apple was not configured on admin.

Remaining outside this local code slice:

- Run local/staging/prod OAuth smoke against real Auth clients.
- Decide the final admin scope-to-ADMIN-role policy.
- Bootstrap required Auth users/operators directly in Auth; current admin user
  rows are not being migrated.
- Add mutating operator controls for app/environment/user suspension.
