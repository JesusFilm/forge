---
id: "feat-401"
title: "Upgrade Better Auth for native resource binding"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-08-20"
duration: 4
depends_on:
  - "feat-121"
blocks:
  - "feat-399"
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "security"
  - "mcp"
---

## Problem

Better Auth 1.6.2 does not preserve an OAuth `resource` from authorization into the authorization-code record. Changelog cannot safely support dynamically registered Codex and Claude clients without a provider upgrade. The upgrade must land separately from Changelog grant enforcement because it affects production identity, OAuth persistence, client registration, token claims, and every existing relying client.

## Entry Points — Read These First

1. `docs/plans/2026-08-20-1524-chore-better-auth-resource-upgrade-plan.md` — implementation-ready upgrade and compatibility contract.
2. `docs/plans/2026-08-19-1635-feat-changelog-forge-auth-plan.md` — blocked dependent plan and native-resource requirements.
3. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md` — Auth ownership, security, and validation rules.
4. `apps/auth/package.json` and `pnpm-lock.yaml` — coordinated Better Auth pins.
5. `apps/auth/src/auth/config.ts` — provider, dynamic registration, token prefix, audience, claims, and social/self-provider configuration.
6. `apps/auth/src/services/oauth-authorization-code.service.ts` and `apps/auth/src/auth/device-grant-plugin.ts` — intentional provider-internal compatibility seam.
7. `apps/auth/prisma/schema.prisma` and `apps/auth/prisma/migrations/` — hand-maintained provider persistence.
8. `apps/auth/src/services/device-grant.integration.test.ts` — scratch PostgreSQL and real-provider precedent.

## Grep These

- `better-auth|@better-auth` in Auth and Mobile package manifests, source, and lockfile.
- `authorizationCodeIdentifier|createVerificationValue|authTime|referenceId` in `apps/auth/src`.
- `jfp_at_|jfp_rt_|jfp_cs_|storeTokens|customAccessTokenClaims` in Auth configuration and tests.
- `allowDynamicClientRegistration|allowUnauthenticatedClientRegistration|validAudiences|resource` in provider configuration.
- `oauth2/authorize|oauth2/token|oauth2/introspect|oauth2/revoke|well-known` in Auth routes and tests.
- `providerId_accountId|issuer|genericOAuth|oauth2/callback` in Auth identity and self-provider paths.

## What To Build

1. Capture the Better Auth 1.6.2 provider contract before changing dependencies.
2. Upgrade the coordinated `apps/auth` Better Auth packages to 1.7.1, the production target above the 1.7.0 native-resource security floor.
3. Add and backfill the required account, OAuth resource, client, consent, access-token, refresh-token, and replay persistence with rollback-compatible expansion.
4. Replace audience-list and custom reserved-claim behavior with native provider resources while preserving each current audience and relying-client contract.
5. Preserve the custom TV device grant and its provider-compatible authorization-code bridge.
6. Prove existing clients and the native resource contract through focused and real-PostgreSQL tests.
7. Roll out only through the normal PR-to-main deployment path with migration, maintenance-window, verification, and rollback procedures.

## Constraints

- Do not implement Changelog U2/U3, new grants, consent policy, supported grant operations, or production activation.
- Do not introduce custom authorization-code rewriting, resource CAS state, or a second token issuer.
- Do not intentionally change Admin, Manager, Mastra Studio, Admin MCP, Web, Mobile, Chat, TV, social login, or device-grant behavior.
- Do not partially upgrade the `apps/auth` Better Auth package family.
- Do not drop legacy provider columns or require a destructive database rollback in the first upgrade PR.
- Do not deploy with `railway up`, manual redeploys, or any path outside the normal PR-to-main flow.

## Verification

- The 1.6.2 baseline and 1.7.1 replay pass against PostgreSQL for codes, PKCE, redirects, prefixes, hashes, claims, `referenceId`, refresh, introspection, revocation, DCR, and the custom device grant.
- Resource A is persisted at authorization, issued as the access-token audience, retained through refresh, and cannot be widened to B.
- Fresh and production-shaped databases migrate and seed idempotently; account issuers are trusted and collision-free.
- Existing client-focused suites and full Auth test, typecheck, lint, and build gates pass.
- Changelog production remains disabled and feat-399 stays `in-progress` until this ticket is complete on main.
