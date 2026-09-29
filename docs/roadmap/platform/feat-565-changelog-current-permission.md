---
id: "feat-565"
title: "Serve current Changelog permissions to protected consumers"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-29"
duration: 1
depends_on:
  - "feat-399"
blocks: []
tags:
  - "auth"
  - "changelog"
  - "security"
---

## Problem

JesusFilm/jfp-changelog#152 requires a previously issued website credential to
observe grant reductions on the next protected request. Token issuance and
refresh validation alone cannot enforce this for an already open session.

## Entry Points — Read These First

1. `apps/auth/src/app/api/changelog/current-permission/route.ts` — request
   validation, fixed error codes, and `Cache-Control: no-store`.
2. `apps/auth/src/services/changelog-current-permission.service.ts` — bearer
   verification, environment binding, account checks, and current grant lookup.
3. `apps/auth/src/services/changelog-oauth-grant.integration.test.ts` — issued
   credential and grant-reduction coverage.
4. `apps/auth/src/services/changelog-contributors.service.ts` — grant writer's
   `app_environment` row lock that the permission lookup coordinates with.

## Grep These

- `currentChangelogPermission` — route and decision service.
- `CHANGELOG_OAUTH_RESOURCES` — local and production token audiences.
- `FOR UPDATE` and `FOR SHARE` — grant writer and permission reader locks.
- `revokedAt: null` — approved, live grant filter.

## What To Build

Expose `GET /api/changelog/current-permission` with a single seeded `clientId`
query parameter and an Auth-issued bearer token. The service returns
`{ subject: string, clientId: string, environment: "local" | "production",
scopes: string[] }` after verifying the JWT and intersecting live grants with
the token's issued scopes. Return an empty `scopes` array for No Access.

## Contract

`GET /api/changelog/current-permission?clientId=<seeded Changelog client>`
requires an Auth-issued bearer access token. A successful response is
`{ subject, clientId, environment, scopes }` with `Cache-Control: no-store`.
The three Changelog scopes reflect current Auth grants intersected with the
token's issued scope ceiling. An empty array means No Access. The selected
client binds the local or production environment; dynamic MCP tokens must have
matching signed audience, app, and environment claims. Errors are fixed codes:
400 malformed request, 401 invalid credential, 403 inactive or unavailable
authority, and 503 temporary inability to establish permission.

Grant writers must retain the environment-row lock so a permission reduction
committed before a lookup starts is visible to that lookup. Consumers must
validate subject, client, environment, scopes, and their own credential ceiling;
they must fail closed on errors without falling back to cached rights.

## Constraints

- Keep Auth as the source of app-level scopes and grants; relying apps own
  their domain authorization.
- Do not expose bearer tokens, grant details, or internal failures in responses.
- Do not widen an issued token when current grants are upgraded.
- Deploy Auth before enabling the Changelog website consumer. This work does
  not change production grants or deploy either service.

## Verification

Run `pnpm --filter @forge/auth typecheck`, `pnpm --filter @forge/auth lint`,
and `pnpm --filter @forge/auth test` (with disposable PostgreSQL for integration
tests). Check issued OAuth credentials against grant reductions, environment
binding, credential scope ceilings, inactive membership, account expiry,
reactivation, and temporary failures. Check that every response is non-cacheable
and that storage failures return 503 while invalid credentials return 401.
