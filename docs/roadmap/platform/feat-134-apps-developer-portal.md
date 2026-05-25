---
id: "feat-134"
title: "Apps Developer Portal"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-05-25"
duration: 8
depends_on:
  - "feat-121"
  - "feat-133"
blocks:
  - "feat-135"
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "infrastructure"
---

## Problem

Forge now has a standalone Auth authority in `apps/auth`, and Admin, Manager,
and Mastra Gateway authenticate through Auth. The next platform gap is an
operational developer surface for first-party and future third-party app
registrations without turning Strapi into an auth dependency or duplicating
OAuth provider behavior outside Auth.

Build `developer.jesusfilm.org` as a separate app that manages or presents
Auth-owned app registration data. Auth remains the identity/OAuth authority and
the issuer of credentials, tokens, grants, revocation, and audit events.

## Entry Points - Read These First

1. `docs/plans/2026-05-25-001-feat-apps-developer-portal-plan.md`
2. `docs/roadmap/platform/feat-121-jesus-film-auth-platform.md`
3. `docs/roadmap/platform/feat-133-auth-consolidation-across-apps.md`
4. `docs/auth-consolidation/surface-inventory.md`
5. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md`
6. `apps/auth/prisma/schema.prisma`
7. `apps/auth/src/domain/apps.ts`
8. `apps/auth/src/domain/scopes.ts`
9. `apps/auth/src/scripts/seed-first-party-apps.ts`
10. `docs/solutions/platform/adding-new-apps.md`
11. `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`

## Grep These

- `FIRST_PARTY_APP_SEEDS|RegisteredApp|AppEnvironment|OauthClient` in
  `apps/auth`
- `developer:access|jfp_developer` in `apps/auth` and `apps/developer`
- `clientSecret|client_secret|secret` in `apps/developer`
- `apps/cms|Strapi|strapi-jwt` in any proposed auth changes
- `railway.toml|HOSTNAME=0.0.0.0|healthcheckPath` in `apps/*`

## What To Build

1. Scaffold `apps/developer` as a separate Next.js app intended for
   `developer.jesusfilm.org`.
2. Register the developer portal as a first-party Auth relying client with a
   dedicated `developer:access` scope.
3. Add a read-only registry surface that shows Auth-owned registered apps,
   environments, OAuth client ids, redirect URIs, scopes, and approval status.
4. Keep this first PR narrow: no self-service production credential creation,
   no raw secret exposure, and no mutation-heavy app management.
5. Document the future third-party posture: audit logging, one-time secret
   reveal/regeneration, redirect URI validation, and production approval gates.
6. Keep registry data disabled by default unless the deployment explicitly
   opts into read-only mode behind the intended access boundary.
7. Leave Strapi/CMS authentication untouched.

## Constraints

- Do not change `apps/cms` authentication.
- Do not make Strapi an Auth relying client.
- Do not duplicate Auth OAuth provider routes, token issuance, revocation, or
  credential validation inside `apps/developer`.
- Do not expose raw client secrets.
- Treat direct Auth database reads as a first-slice read-only projection until
  an Auth-owned management API or shared data package is introduced.
- Production app credentials require explicit review/approval before use.

## Verification

- `pnpm --filter @forge/developer lint`
- `pnpm --filter @forge/developer typecheck`
- `pnpm --filter @forge/developer test`
- `pnpm --filter @forge/auth test -- apps scopes seed-first-party-apps`
- The developer app renders without secrets and without depending on Strapi.
- Registry data does not render unless `DEVELOPER_REGISTRY_MODE=readonly`.
- `apps/auth/src/domain/apps.ts` seeds Developer separately from Admin,
  Manager, and Mastra Gateway.
- No `apps/cms` auth files are modified.
