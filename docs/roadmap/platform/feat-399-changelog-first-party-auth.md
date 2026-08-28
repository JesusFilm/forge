---
id: "feat-399"
title: "Register Changelog with first-party Auth grants"
owner: "edmonday"
priority: "P0"
status: "complete"
start_date: "2026-08-19"
duration: 3
depends_on:
  - "feat-121"
  - "feat-401"
blocks:
  - "feat-426"
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
6. After feat-401 is complete, downscope the human OAuth authorization request against approved Changelog grants before native code creation, then revalidate the immutable user/application/environment tuple and provider-bound exact dynamic MCP resource at code exchange and refresh.
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
- Do not upgrade Better Auth in this ticket; consume the completed feat-401 native-resource upgrade from main.
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

## Implementation status

The implementation above merged to `main` in
[PR #1973](https://github.com/JesusFilm/forge/pull/1973) as `74fce10a` on
2026-08-24. [GitHub Actions run 32685302674](https://github.com/JesusFilm/forge/actions/runs/32685302674)
applied all six Auth migrations, completed first-party seeding, and passed all
18 native PostgreSQL tests across the Better Auth upgrade, device-grant, and
Changelog OAuth suites. These database tests remain opt-in locally and now run
in the affected-Auth `auth-postgres-integration` CI job; fail-closed aggregate
merge enforcement remains separate follow-up work.

The provider boundary, exact-resource grant decision, authorization
downscoping, exchange/refresh revalidation, dynamic-registration resource
defaults, consent disclosure, and opt-in PostgreSQL integration contract are
implemented. The scratch-database proof covers native dynamic consent, seeded
and dynamic PKCE exchange, both default DCR resource links, exact audiences,
grant revocation before code exchange and refresh, zero token rows on denial,
cross-resource rejection, and production-off behavior. Production issuance
remains default-off.

Acceptance completed locally on 2026-08-24 against Forge `a4c9e3ba` and
`JesusFilm/jfp-changelog` `4babe81`. Changelog exposed a protected Streamable
HTTP `/mcp` endpoint plus the PostgreSQL-backed `list_entries` tool, and a
disposable Forge database contained one approved local `changelog:read` grant
and one published test entry. Separate clean CLI profiles completed dynamic
registration and authorization:

- Codex registered native client `StXZJVoOsCKzKGgVWwUbrLSIvVOlHWGe` with a
  `127.0.0.1` callback; Claude registered native client
  `heFkQEOEPcbgyyZOYooMJFcEIuYhCDtU` with a `localhost` callback. Forge commit
  `a4c9e3ba` normalizes omitted or implicit-web DCR metadata to `native` only
  when every redirect is an exact HTTP loopback URI, preserving the provider's
  HTTPS requirement for non-loopback web clients.
- Both authorization requests included an ungranted `changelog:submit` scope,
  and both exchanged tokens contained exactly `changelog:read`. Separate
  refresh-family SHA-256 prefixes (`fad10f525b54` for Codex and
  `c6a16308cd2a` for Claude) proved the clients did not share credentials.
- Codex read `Protected MCP reads are available`, refreshed from access-token
  digest `ef3860e2b443` to `8a326bee7eaa`, then read the same entry after
  reconnect. Claude independently read the entry, refreshed from
  `f3b57130de51` to `03e17068181d`, and read it again.
- A submit-only authorization request for each client returned
  `access_denied` with no authorization code. Production remained disabled
  throughout with `AUTH_CHANGELOG_PRODUCTION_ENABLED=false`.

A post-fix receipt on 2026-08-25 covered the final public-client and MCP
hardening at Forge `91d9fdb5` and Changelog `858e2cf`. Fresh Codex-style and
Claude-style registrations created different native public clients,
`AamZxnppdsqdxOSuHjaKKJUtdEoiFEcs` and
`jciWzrwyCZZTFKehqWoPtuOfIuBcVjfM`, with no client secrets and with their
respective `127.0.0.1` and `localhost` callbacks. The Codex client then
completed authorization-code exchange with PKCE, received only `openid
changelog:read`, read `Protected MCP reads are available`, rotated both its
access and refresh tokens (`c89b8af74f8b` to `07536942db2b` and
`27b9be4bfd19` to `38e0b9de817f`), and read the entry again after refresh. The
temporary port-3999 metadata proxy used for this receipt did not forward the
Next.js development WebSocket, so its server-rendered consent page could not
hydrate; after explicit user approval, the same authenticated consent payload
was submitted directly to the consent endpoint. The earlier browser consent,
two-client lifecycle, independent token-family, and denied-capability evidence
above remains the end-to-end UI receipt.

Verification passed with 468 Forge Auth unit tests (18 opt-in integration tests
skipped in the aggregate command), focused route tests, Auth typecheck and
lint, plus 104 Changelog tests and Changelog typecheck. The earlier PostgreSQL
CI receipt above covers all 18 Forge integration tests. Preview registration
remains deliberately deferred until Changelog has a stable preview domain.
Supported grant provisioning and revocation remain separate production-
readiness work and are still prerequisites for enabling production issuance.
