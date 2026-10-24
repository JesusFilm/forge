---
id: "feat-426"
title: "Repair Admin MCP OAuth resource binding"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-26"
duration: 2
depends_on:
  - "feat-399"
  - "feat-401"
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "security"
  - "admin"
  - "mcp"
---

## Problem

Forge Auth dynamically registers public loopback MCP clients with only the
Changelog resource defaults while every protected resource still shares the
global Auth scope catalogue. Codex therefore receives no Admin MCP resource
link and can be diverted into Changelog policy before the provider evaluates
its explicit Admin target. Dynamic Admin tokens also need trusted app and
environment claims derived from the canonical resource rather than client
metadata.

## Entry Points — Read These First

1. `docs/plans/2026-08-26-1307-fix-admin-mcp-oauth-binding-plan.md` — authoritative implementation and post-merge acceptance contract.
2. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md` — Auth security, routing, seeding, and verification rules.
3. `apps/auth/src/auth/config.ts` — OAuth provider resources, scopes, defaults, and token claims.
4. `apps/auth/src/app/api/auth/[...all]/route.ts` — loopback DCR normalization and authorization policy.
5. `apps/auth/src/scripts/seed-first-party-apps.ts` — resource rows, client links, and startup repair.
6. `apps/admin/AGENTS.md`, `apps/admin/CLAUDE.md`, and `apps/admin/src/auth/admin-mcp-oauth.ts` — Admin MCP token boundary.
7. `apps/admin/src/services/experience.service.ts` and `apps/admin/src/services/experience-locale-mcp.service.ts` — shared-draft locking and MCP mutation path.

## Grep These

- `defaultProtectedResourceUrls|allowedProtectedResourceUrls|validAudiences` in `apps/auth/src`
- `normalizeLoopbackDcrRequest|applyChangelogAuthorizePolicy` in the Auth catch-all route
- `OauthClientResource|isCodexLoopbackMcpCallback|offline_access` in the Auth seeder
- `customAccessTokenClaims|admin-mcp|environment` in Auth and Admin MCP auth
- `stageLocaleDraft|discardLocaleDraft|experience.locale.update` in `apps/admin/src`

## What To Build

1. Define one typed OAuth resource catalogue with per-resource scopes, trusted Admin app/environment claims, and public-DCR exposure.
2. Restrict unauthenticated registration to exact public native loopback PKCE clients, public MCP resources, and the union of their scopes.
3. Require one canonical public MCP target for every unseeded dynamic authorization and classify explicit resources before Changelog fallbacks.
4. Repair eligible existing loopback clients additively and transactionally during startup without rewriting issued grants or tokens.
5. Make consent target-aware and mark all unseeded dynamic client names unverified.
6. Accept dynamic production Admin clients while preserving issuer, audience, environment, membership, role, scope, and service ABAC checks.
7. Add nullable compare-and-set semantics and conditional rollback for MCP shared-draft writes while preserving Admin UI behavior.
8. Prove the provider lifecycle against PostgreSQL and the Admin consumer boundary with focused tests.

## Constraints

- Keep Better Auth pinned to 1.7.1.
- Do not weaken Changelog AppGrant policy or production activation.
- Do not expose Manager, Auth issuer, custom audience, or global Auth scopes through unauthenticated DCR.
- Do not trust client name or registration metadata for first-party status, product, app, or deployment environment.
- Do not publish an Experience, mutate WordPress, deploy local code directly, or perform production writes from the implementation branch.
- Keep repair logs redacted and the data change additive and rollback-compatible.

## Verification

- Focused Auth catalogue, provider config, catch-all route, and seed tests pass.
- Real-PostgreSQL Better Auth and Changelog integration suites prove registration, resource-bound authorize/exchange/refresh, substitution failures, and grant preservation.
- Admin MCP route and Experience service tests prove dynamic production token acceptance, role/ABAC enforcement, nullable expected revisions, and conditional rollback.
- Full Auth test, typecheck, lint, and build gates pass; Admin focused tests and typecheck pass.
- `git diff --check` and the roadmap consistency check pass.

## Resolution

- Added a typed, resource-specific OAuth catalogue and restricted public DCR
  to native HTTP loopback Authorization Code clients with PKCE.
- Made explicit resource selection authoritative, preserved Changelog grant
  isolation, and derived Admin app/environment claims from canonical resources.
- Added additive startup repair for provider-created public loopback clients,
  including Better Auth rows that persist `public: null`.
- Added target-aware consent, dynamic production Admin client support, and
  compare-and-set draft updates with conditional rollback.
- Verified the implementation with focused Auth/Admin suites, both package
  typechecks, lint, and real PostgreSQL provider and Changelog integration
  suites. Production OAuth acceptance and the requested homepage draft remain
  the plan's post-merge acceptance step.
