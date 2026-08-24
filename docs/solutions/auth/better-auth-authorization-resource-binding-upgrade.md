---
title: Upgrade Better Auth when authorization drops the OAuth resource binding
date: 2026-08-21
last_updated: 2026-08-24
category: auth
module: apps/auth
problem_type: security_issue
component: authentication
symptoms:
  - Better Auth did not persist the RFC 8707 resource from the authorization request into its authorization-code state
  - A token exchange could request a resource that was not bound to the user's authorization grant
  - Dynamic public PKCE clients could not be enabled safely while exact authorization-to-token resource binding was unproven
  - Existing OAuth, device-grant, token, account-identity, and route contracts had to remain unchanged while provider persistence expanded
root_cause: missing_capability
resolution_type: dependency_update
severity: high
tags:
  [
    better-auth,
    oauth,
    rfc-8707,
    protected-resource,
    authorization-code,
    refresh-token,
    postgresql,
    rollback,
  ]
---

# Upgrade Better Auth when authorization drops the OAuth resource binding

## Problem

Forge needed dynamic OAuth registration for public PKCE clients, with an exact
protected resource preserved from authorization through code exchange and
refresh. Better Auth 1.6.2 stripped the RFC 8707 `resource` parameter before it
wrote the authorization-code record, so the provider could not prove that a
token request stayed within the grant the user authorized.

This could not be solved as a routine package bump. Forge also relies on Better
Auth persistence contracts for OAuth clients, token identifiers, account
identity, `referenceId`, refresh rotation, introspection, and the custom TV
device-grant bridge.

## Symptoms

- Resource A was absent from the provider-owned authorization-code state.
- A later token request therefore had no durable authorization-time resource
  ceiling to enforce.
- Seeded-client tests could pass while the required dynamic-registration path
  remained unsafe.
- A provider upgrade expanded the database shape and risked changing existing
  first-party and device flows.

## What Didn't Work

- Staying on Better Auth 1.6.2 was not viable. Its authorization query parser
  removed `resource` before persistence, which is the security boundary the
  feature needed.
- A Forge-owned post-provider rewrite or compare-and-set mechanism was rejected.
  It would introduce a second source of authorization state and another
  dependency on Better Auth's private hashed identifier and JSON shape.
- Seeded-client-only MCP support was insufficient because engineers must be able
  to connect their own dynamically registered Codex or Claude clients.
- Before PR #1973, ordinary GitHub CI was not conclusive. The real-PostgreSQL
  suites skip unless `AUTH_TEST_DATABASE_URL` is supplied, so a green standard
  test job could omit the authorization, exchange, refresh, revocation, and
  device-flow contracts.
- A database with migrations but without the first-party seed was not a valid
  integration environment. The Manager resource and seeded TV client were
  absent, which produced setup and foreign-key failures until the scratch
  database was recreated, migrated, and seeded. _(session history)_
- Early database runs shared incompatible test secrets and counted residual
  fixture tokens. Using one explicit test secret and scoping persistence
  assertions by a unique `referenceId` made the suites repeatable. _(session
  history)_
- Absorbing unrelated Expo patch drift into the Auth upgrade would have broken
  the prerequisite's isolation. Those dependency updates were shipped through a
  separate Mobile PR before the Auth branch was updated from main. _(session
  history)_

## Solution

Upgrade the coordinated Better Auth packages together and use the provider's
native protected-resource model as the only authority for OAuth audiences. In
[PR #1978](https://github.com/JesusFilm/forge/pull/1978), Forge pins the Auth
packages to 1.7.1, configures `resources` and
`clientRegistrationAllowedResources`, and stops authoring `aud` as a custom
access-token claim.

Prove the native lifecycle through the real provider and PostgreSQL:

1. Dynamically register a public PKCE client for resource A.
2. Authorize resource A and assert the provider-owned authorization-code JSON
   persists A.
3. Reject exchange for A plus B with `invalid_target` and create no token row.
4. Exchange for A, or omit the token-request resource and inherit A; assert the
   access-token audience and refresh-token resource ceiling are A.
5. Allow refresh within A and reject refresh for B.

Draft [PR #1973](https://github.com/JesusFilm/forge/pull/1973) adds an
`auth-postgres-integration` job for changes that affect `@forge/auth`. On that
PR, the job starts PostgreSQL 18, applies the Auth migrations, runs the
first-party seed, and then executes the Better Auth, device-grant, and Changelog
OAuth integration suites sequentially with `--no-file-parallelism`. The test
files remain opt-in for ordinary local runs; CI supplies
`AUTH_TEST_DATABASE_URL` when the database contract must run.

The seed is part of the contract, not fixture convenience. Migrations create
the provider schema, while `seed:first-party-apps` creates the declared scopes,
applications, environments, OAuth clients, resources, and client-resource
bindings that the native flows resolve. Serial file execution prevents the
three suites from racing while they mutate and clean up that shared inventory.

[GitHub Actions run 32685302674](https://github.com/JesusFilm/forge/actions/runs/32685302674)
verified the workflow on PR #1973: six migrations applied, the first-party seed
completed, and all 18 native tests passed across the Better Auth upgrade (7),
device grant (8), and Changelog OAuth grant (3) suites.

The migration remains additive during the rollback window. It introduces the
provider's resource tables and token-resource state while retaining the legacy
OAuth client columns needed by 1.6.2. Account issuer finalization derives values
only from trusted provider configuration, rejects unknown providers, mismatches,
and identity collisions, then enforces the new uniqueness boundary. A database
trigger lets a rolled-back 1.6.2 runtime continue creating mapped accounts while
failing closed for unknown providers.

Keep the custom TV device bridge deliberately resource-less. It may create only
the legacy authorization-code shape, while Better Auth remains responsible for
the actual token exchange. It must never become an alternate way to mint a
resource-bound code.

## Why This Works

The provider now owns one resource ceiling for the entire authorization grant.
The authorization code records the user's choice, exchange can only inherit or
narrow it, access-token `aud` reflects the selected resource, and refresh cannot
widen the original grant. No Forge-side state channel can drift from provider
validation.

The upgrade is guarded by compatibility contracts rather than assumptions. The
real-database suite covers one-time code exchange, S256 PKCE, redirect and client
binding, deterministic token identifiers, prefixes, `referenceId`, `authTime`,
refresh rotation, revocation, claims, introspection, client credentials, dynamic
registration, and the existing TV device flow.

Rollback is application rollback over the retained additive schema, not a down
migration. Because 1.6.2 cannot enforce resource ceilings stored by 1.7, any
resource-bound refresh-token families created after the upgrade must be revoked
or their clients disabled before restoring 1.6.2.

## Prevention

- Treat provider-owned authorization-code and refresh-token state as a security
  boundary. Do not repair missing resource lineage by rewriting private provider
  records.
- Upgrade `better-auth` and coordinated `@better-auth/*` packages as one tested
  set.
- Keep a real-PostgreSQL compatibility contract for every private-provider seam:
  authorization-code hashing and JSON, PKCE, redirects, client authentication,
  token prefixes and hashes, `referenceId`, refresh rotation, claims,
  introspection, dynamic registration, and device exchange.
- Keep the `AUTH_TEST_DATABASE_URL` suites optional locally, but run them in the
  affected-Auth PostgreSQL job after migrations and first-party seeding.
- Treat job execution and merge enforcement as separate controls. Add the job
  to the repository's stable required-check aggregate or require its named check
  in the external ruleset; a successful conditional workflow job does not by
  itself prove that a future failure blocks merging.
- Make affected-package detection fail closed, and make the aggregate verify
  that `auth-postgres-integration` actually ran whenever `@forge/auth` is
  affected. A required aggregate that accepts skipped jobs can still pass if
  affected detection falls back to an empty package list.
- Keep schema changes additive until the rollback window closes, and backfill
  identity only from trusted configuration with collision and mismatch checks.
- Keep legacy no-resource device grants unable to synthesize resource-bound
  codes.
- Do not resume dependent protected-resource work until the upgrade is on main
  and the exact authorize-to-exchange-to-refresh database contract has passed.

## Related Issues

- [Better Auth resource upgrade plan](../../plans/2026-08-20-1524-chore-better-auth-resource-upgrade-plan.md)
- [OAuth grant via authorization-code delivery, not token translation](../architecture-patterns/oauth-grant-via-authorization-code-delivery-not-token-translation.md)
- [OAuth-protected MCP tool parity pattern](../architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md)
- [feat-401 roadmap ticket](../../roadmap/platform/feat-401-better-auth-native-resource-upgrade.md)
- [feat-399 Changelog first-party Auth ticket](../../roadmap/platform/feat-399-changelog-first-party-auth.md)
