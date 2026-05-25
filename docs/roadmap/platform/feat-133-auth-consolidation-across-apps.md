---
id: "feat-133"
title: "Auth Consolidation Across Apps"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-05-22"
duration: 6
depends_on:
  - "feat-121"
  - "feat-125"
blocks:
  - "feat-134"
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "manager"
  - "admin"
---

## Problem

The Auth platform and Manager OAuth migration establish the right direction:
human staff tools should authenticate through `apps/auth` with app-local
sessions. The remaining platform risk is drift. Admin, Manager, Web, Mobile,
TV, scripts, and CI still carry a mix of app-local sessions, env bearer keys,
consumer rate-limit bearers, Manager backend keys, and Strapi-era auth
artifacts.

Consolidate the remaining auth surfaces around the Auth pattern without
modernizing Strapi. `apps/cms` should stay a legacy dependency to retire in the
Strapi sunset track, not become an OAuth relying client.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-22-auth-consolidation-requirements.md`
2. `docs/plans/2026-05-22-001-feat-auth-consolidation-plan.md`
3. `docs/roadmap/platform/feat-121-jesus-film-auth-platform.md`
4. `docs/roadmap/platform/feat-125-manager-auth-oauth-admin-backend-migration.md`
5. `apps/auth/src/domain/scopes.ts`
6. `apps/auth/src/services/token-policy.service.ts`
7. `apps/admin/src/graphql/context.ts`
8. `apps/admin/src/auth/manager-bearer.ts`
9. `apps/manager/src/lib/auth.ts`
10. `apps/manager/src/lib/admin-manager-session.ts`
11. `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`
12. `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`

## Grep These

- `AUTH_ISSUER_URL|AUTH_ADMIN_CLIENT_ID|AUTH_MANAGER_CLIENT_ID` in `apps`
- `strapi-jwt|/api/auth/local|/api/users/me|STRAPI_API_TOKEN` in `apps/manager`
- `WORKFLOW_API_KEYS|WEB_ADMIN_API_KEYS|MANAGER_ADMIN_API_KEY|ADMIN_MANAGER_API_KEY|ADMIN_TRIGGER_API_KEYS|MANAGER_API_KEY|BACKUP_DOWNLOAD_API_KEYS` in `apps`
- `isValid.*Bearer|Authorization: Bearer|CONSUMER_BEARER|WORKFLOW_TRIGGER|MANAGER_BACKEND` in `apps/admin/src`
- `EXPO_PUBLIC_STRAPI_TOKEN|STRAPI_PREVIEW_SECRET` in `apps/web`, `apps/mobile`, and `apps/tv`

## What To Build

1. Inventory all human session, legacy cookie, app-local OAuth, env bearer,
   Auth-owned token, and Strapi-dependent auth surfaces.
2. Classify each surface as keep, convert to Auth-issued credential, replace,
   or delete with Strapi sunset.
3. Verify Admin and Manager human auth are fully aligned with Auth OAuth and
   app-local sessions.
4. Convert one narrow service-to-service surface first: Manager calling Admin's
   Manager session validation contract. Keep the existing env bearer in
   dual-accept mode until staged smoke proves the Auth-issued replacement.
5. Add receiver-side validation for issuer, audience, environment, scope,
   expiry, and revocation before removing any legacy bearer.
6. Update operator-facing docs to distinguish Auth-owned access, app-local
   authorization, legacy/internal bearers, and Strapi sunset dependencies.

## Constraints

- Do not migrate `apps/cms` authentication to `apps/auth`.
- Do not make `apps/cms` an OAuth/OIDC relying client.
- Do not change Strapi admin users, roles, API token behavior, or GraphQL auth.
- Do not decommission Strapi data, schedulers, GraphQL consumers, or job state
  in this ticket.
- Do not make Auth own Admin ABAC or Manager role semantics.
- Do not force every env-CSV bearer into Auth-issued tokens. Use the existing
  credential-storage decision matrix and keep narrow internal bearers where
  that remains the right threat model.
- Never log raw bearer tokens, client secrets, refresh tokens, passwords,
  database URLs, or unnecessary PII.

## Verification

- Auth surface inventory exists and classifies every discovered session,
  bearer, and Strapi auth artifact.
- Admin and Manager login smoke prove Auth OAuth plus host-local sessions.
- Manager dashboard rejects a request with only `strapi-jwt`.
- Admin editorial roles do not imply Manager dashboard access without explicit
  Manager membership.
- Manager -> Admin session validation accepts the Auth-issued service
  credential and rejects wrong issuer, wrong audience, wrong environment,
  missing scope, expired token, and revoked token.
- Legacy Manager -> Admin bearer still works during dual-accept rollout and is
  removed only after receiver-first deployment notes and smoke proof exist.
- No implementation unit changes Strapi/CMS authentication.
- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/manager test`

## Progress Notes

- 2026-05-22: Created the auth surface inventory and first-slice plan.
- 2026-05-22: Added the Manager session-validation service scope and seeded
  disabled Manager service OAuth clients for each first-party environment.
- 2026-05-22: Added Admin dual-accept validation for Auth introspection tokens
  plus the legacy `MANAGER_ADMIN_API_KEY` fallback.
- 2026-05-22: Updated Manager to prefer the Auth service client when
  configured and fall back to `ADMIN_MANAGER_API_KEY`.
- Remaining before completion: staged smoke with real Auth-seeded service
  secrets, explicit revoked-token smoke, conversion plan for other bearer
  surfaces, and eventual legacy bearer removal after receiver-first rollout.
