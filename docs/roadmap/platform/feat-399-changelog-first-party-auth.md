---
id: "feat-399"
title: "Register Changelog with first-party Auth grants"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-08-19"
duration: 3
depends_on:
  - "feat-121"
  - "feat-400"
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "security"
---

## Problem

JesusFilm/jfp-changelog issue #71 requires Changelog to use Jesus Film Auth as its identity and application-access authority. Forge Auth does not yet register Changelog's scopes, OAuth clients, or MCP resource audiences, and production must not launch unless token issuance enforces explicit Changelog grants and operators have a supported way to provision them.

The initial Forge slice covers local and production only. Preview is deferred because Changelog does not yet have a stable preview deployment and callback domain.

## Entry Points — Read These First

1. `docs/plans/2026-08-19-1635-feat-changelog-forge-auth-plan.md` — implementation-ready Product and Planning Contracts.
2. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md` — Auth ownership, security, seeding, and validation rules.
3. `apps/auth/src/domain/scopes.ts` — closed Auth scope catalogue.
4. `apps/auth/src/domain/apps.ts` — first-party application and environment definitions.
5. `apps/auth/src/scripts/seed-first-party-apps.ts` — public-client seed behavior and idempotent upserts.
6. `apps/auth/src/config/env.ts` and `apps/auth/src/app/api/auth/[...all]/route.ts` — audience/activation configuration and the OAuth provider boundary.
7. `apps/auth/prisma/schema.prisma` — application, environment, client, and `AppGrant` persistence.
8. `docs/plans/2026-08-20-1524-chore-better-auth-resource-upgrade-plan.md` — prerequisite native-resource provider upgrade.
9. `docs/roadmap/platform/feat-230-web-auth-client-registration.md` — prior public PKCE client registration.

## Grep These

- `ADMIN_APP|MANAGER_APP|MASTRA_STUDIO_APP|FIRST_PARTY` in `apps/auth/src/domain` and `apps/auth/src/scripts`
- `AppGrant|approved|active|environment` in `apps/auth/src`
- `requestedScopes|allowedScopes|scope` in OAuth authorization and token issuance paths under `apps/auth/src`
- `AUTH_VALID_AUDIENCES|validAudiences` in Auth configuration and deployment documentation
- `tokenEndpointAuthMethod|requirePKCE|clientSecret` in first-party seed tests

## What To Build

1. Add `changelog:read`, `changelog:submit`, and `changelog:admin` to the Auth scope catalogue with the labels and descriptions in the Product Contract.
2. Register Changelog as a Jesus Film Project first-party application with exactly `local` and `production` environments.
3. Seed `jfp_changelog_local` and `jfp_changelog_production` as public authorization-code clients that require PKCE and have the exact origins and login/logout callbacks in the Product Contract.
4. Allow both clients to request the required identity, membership, and Changelog scopes without granting those scopes to an Auth account automatically.
5. Register or document the local and production Changelog MCP audiences according to the existing `AUTH_VALID_AUDIENCES` convention.
6. After feat-400 is complete, downscope the human OAuth authorization request against approved Changelog grants before native code creation, then revalidate the immutable user/application/environment tuple and provider-bound exact dynamic MCP resource at code exchange and refresh.
7. Add the smallest repo-consistent Changelog enforcement seam if the current path ignores grants, without changing access behavior for Admin, Manager, Mastra Studio, or other existing first-party applications.
8. Keep production Changelog scope issuance disabled by default behind an explicit activation setting until a supported grant-provisioning/revocation path exists; direct database edits must not bypass that gate.

## Constraints

- Do not register preview or staging clients or audiences in this ticket.
- Do not add a confidential client or client secret.
- Do not treat client-allowed scopes as user grants.
- Do not grant Changelog access to every Auth account.
- Do not move entry ownership, edit/delete policy, or product administration rules into Auth.
- Do not add Firebase authentication, Changelog-local email allowlists, shared cross-application cookies, or unrelated dashboard work.
- Stop and report a conflict if Forge defines a different canonical Changelog production domain.
- Do not weaken or alter access behavior for existing first-party applications.
- Do not upgrade Better Auth in this ticket; consume the completed feat-400 native-resource upgrade from main.
- Do not add a custom authorization-code rewrite, resource CAS channel, or second token issuer.

## Verification

- Focused scope tests recognize all three Changelog scope keys.
- Application and seed tests prove exactly two environments, exact client IDs, origins, redirects, post-logout redirects, allowed scopes, public-client posture, PKCE, seeder inclusion, and rerun idempotence.
- Grant, route, and real-database tests prove denial without an approved grant; exact reader, submitter, and administrator bundles; immutable dynamic MCP resource binding; refresh revocation; unchanged code state after invalid exchange input; and denial for inactive, unapproved, wrong-application, or wrong-environment grants.
- Production scope issuance remains denied while the activation setting is disabled, including when matching grant rows exist.
- Independent dynamically registered Codex and Claude clients complete exact-resource authorization, exchange, refresh, and reconnect without seeded client credentials.
- Regression tests prove Admin, Manager, and Mastra Studio registrations and access behavior remain unchanged.
- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
- Deployment notes identify the migration or seed command, audience configuration, supported grant-provisioning path, and the preview deferral.
