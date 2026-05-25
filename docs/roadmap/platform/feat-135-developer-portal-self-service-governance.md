---
id: "feat-135"
title: "Developer Portal Self-Service Governance"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-06-02"
duration: 10
depends_on:
  - "feat-134"
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "security"
---

## Problem

`apps/developer` now has a narrow read-only view of Auth-owned app
registration data. Before it can support first-party mutations or third-party
self-service, the write path needs Auth-owned policy enforcement instead of
direct UI writes.

Build the governance layer for app registration mutations: Developer should be
an Auth relying client and should call Auth-owned management APIs for app,
environment, redirect URI, credential, approval, audit, and revocation changes.

## Entry Points - Read These First

1. `docs/roadmap/platform/feat-134-apps-developer-portal.md`
2. `docs/plans/2026-05-25-001-feat-apps-developer-portal-plan.md`
3. `apps/developer/AGENTS.md` and `apps/developer/CLAUDE.md`
4. `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md`
5. `apps/auth/prisma/schema.prisma`
6. `apps/auth/src/services/app-registry.service.ts`
7. `apps/auth/src/services/audit.service.ts`
8. `apps/auth/src/services/oauth-policy.service.ts`
9. `apps/auth/src/services/revocation.service.ts`

## Grep These

- `developer:access|jfp_developer` in `apps/auth` and `apps/developer`
- `clientSecret|client_secret|jfp_cs_` in `apps/auth` and `apps/developer`
- `redirectUris|allowedOrigins|autoApprove|ApprovalStatus` in `apps/auth`
- `AuthAuditEvent|audit.service` in `apps/auth`

## What To Build

1. Add the Developer OAuth relying-client login flow and app-local session.
2. Add Auth-owned management APIs for registry reads and carefully scoped
   mutations.
3. Add first-party app/environment update flows with audit events.
4. Add third-party app request flow with partner/external ownership metadata.
5. Add redirect URI validation for local, preview, staging, and production.
6. Add production approval queue before production credentials can issue
   tokens.
7. Add one-time client secret reveal and explicit regeneration flow for
   confidential/service clients.
8. Replace direct Auth database reads in `apps/developer` with Auth management
   API calls before enabling writes.

## Constraints

- Do not duplicate Auth OAuth provider behavior in Developer.
- Do not expose raw client secrets except during a one-time reveal immediately
  after generation.
- Do not permit production token issuance from pending, rejected, or revoked
  environments.
- Do not change Strapi/CMS authentication.
- Do not make Strapi an Auth relying client.

## Verification

- Developer login requires Auth and `developer:access`.
- Registry mutations are rejected without an active Developer session.
- Every mutation creates an Auth audit event.
- Production credentials cannot be used until approved.
- Redirect URI validation rejects wildcard, javascript, data, and unapproved
  production origins.
- Client secret regeneration stores only a hash and reveals the raw secret only
  once.
- `pnpm --filter @forge/developer test`
- `pnpm --filter @forge/developer typecheck`
- `pnpm --filter @forge/developer lint`
- `pnpm --filter @forge/auth test`
