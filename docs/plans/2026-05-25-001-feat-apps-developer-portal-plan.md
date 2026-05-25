---
title: "feat: Apps Developer Portal"
type: feat
status: active
date: 2026-05-25
origin: docs/roadmap/platform/feat-134-apps-developer-portal.md
---

# feat: Apps Developer Portal

## Summary

Create `developer.jesusfilm.org` as a separate Forge app for third-party app
registration, first-party app registration administration, and unified internal
management of app access grants. The first slice is a read-only developer
portal scaffold backed by Auth-owned app registration data, plus a first-party
Auth registration for the portal itself.

## Brainstorm Outcome

Three approaches were considered:

1. Keep using Auth's internal dashboard for app registrations.
   - Lowest code, but keeps production operator access blocked and mixes Auth
     provider operations with developer-facing app management.
2. Build `apps/developer` against Auth-owned data.
   - Creates the right product boundary now while keeping Auth as the OAuth
     authority. This is the recommended first slice.
3. Build a complete third-party self-service console immediately.
   - Higher upside, but too mutation-heavy for the first PR because production
     approval, audit, redirect validation, and secret lifecycle rules need
     sharper design before exposing writes.

The recommended first slice is option 2 with read-only registry views. It
supports first-party operational needs now, uses Auth as the Developer app's
authentication authority, and keeps the third-party self-service path visible
without committing to risky credential mutations in the first PR.

## Key Decisions

- `apps/developer` is a separate Next.js app, not part of Strapi and not part
  of Auth's provider routes.
- Auth owns identity, OAuth/OIDC provider behavior, scopes, app grants, token
  issuance, revocation, audit, and credential lifecycle.
- Developer is the intended unified admin UI for internal app registrations and
  user permission grants across Admin, Manager, Mastra Studio, and Developer,
  while Auth remains the source of truth for grants and policy enforcement.
- Developer reads Auth-owned app registration data for this first slice through
  a read-only projection. A follow-up should replace direct DB reads with an
  Auth-owned management API or shared Auth registry data package when mutations
  begin.
- Developer is itself an Auth relying client. Registry pages require an
  Auth-issued token with `developer:access`, stored in a Developer-local
  session cookie.
- Production credential creation stays out of scope until approval workflow,
  audit events, redirect URI validation, and one-time secret reveal/regenerate
  patterns are implemented.

## Implementation Units

### U1. Roadmap And Plan

**Files**

- Create: `docs/roadmap/platform/feat-134-apps-developer-portal.md`
- Create: `docs/plans/2026-05-25-001-feat-apps-developer-portal-plan.md`

**Test scenarios**

- Roadmap ticket has required frontmatter and references exact source files.
- Ticket explicitly excludes Strapi/CMS auth changes.

### U2. Developer First-Party Auth Registration

**Files**

- Modify: `apps/auth/src/domain/apps.ts`
- Modify: `apps/auth/src/domain/scopes.ts`
- Modify: `apps/auth/src/domain/apps.test.ts`
- Modify: `apps/auth/src/domain/scopes.test.ts`
- Modify: `apps/auth/src/scripts/seed-first-party-apps.test.ts`

**Approach**

- Add `developer:access` as a first-party access scope.
- Seed local, preview, staging, and production OAuth clients for
  `developer.jesusfilm.org` with exact callback/logout URIs.
- Keep clients public + PKCE like other first-party browser apps.

**Test scenarios**

- Developer is included in `FIRST_PARTY_APP_SEEDS`.
- Developer production redirects use `developer.jesusfilm.org`.
- Seed count includes the new app and four environments.

### U3. Developer App Scaffold And Read-Only Registry

**Files**

- Create: `apps/developer/package.json`
- Create: `apps/developer/AGENTS.md`
- Create: `apps/developer/CLAUDE.md`
- Create: `apps/developer/.env.example`
- Create: `apps/developer/next.config.ts`
- Create: `apps/developer/tsconfig.json`
- Create: `apps/developer/vitest.config.ts`
- Create: `apps/developer/src/config/env.ts`
- Create: `apps/developer/src/db/client.ts`
- Create: `apps/developer/src/data/app-registry.ts`
- Create: `apps/developer/src/data/app-registry.test.ts`
- Create: `apps/developer/src/lib/oauth-client.ts`
- Create: `apps/developer/src/lib/oauth-state.ts`
- Create: `apps/developer/src/lib/session-cookie.ts`
- Create: `apps/developer/src/lib/session.ts`
- Create: `apps/developer/src/app/api/auth/login/route.ts`
- Create: `apps/developer/src/app/api/auth/callback/route.ts`
- Create: `apps/developer/src/app/api/auth/logout/route.ts`
- Create: `apps/developer/src/app/layout.tsx`
- Create: `apps/developer/src/app/page.tsx`
- Create: `apps/developer/src/app/apps/[id]/page.tsx`
- Create: `apps/developer/src/app/api/health/route.ts`
- Create: `apps/developer/src/app/globals.css`
- Create: `apps/developer/railway.toml`

**Approach**

- Use a small read-only SQL projection of Auth registry tables:
  `registered_app` and `app_environment`, parsed with Zod before rendering.
- Gate registry pages with Auth OAuth and the `developer:access` scope.
- Render app/environment status, trust tier, client IDs, redirect URIs,
  allowed origins, and default scopes.
- Never render client secrets or token material.
- Surface production status and pending approval posture in the UI.
- Remove local app permission-management surfaces from Admin and Mastra Gateway
  while keeping runtime checks intact until Auth-backed grant enforcement
  replaces them.

**Test scenarios**

- Registry summary counts apps, environments, production approvals, and pending
  reviews.
- View model redacts secret-bearing fields by construction.
- Unauthenticated registry requests redirect to Auth login.
- Callback rejects missing/invalid OAuth state.
- Health route returns `ok`.

## Future Follow-Up

- Replace direct DB projection with Auth-owned registry management APIs before
  introducing writes.
- Add app create/update flows with audit logging and environment review state.
- Add internal user permission management for Admin, Manager, Mastra Studio,
  and Developer access grants, backed by Auth-owned policy and audit.
- Keep local first-party apps free of duplicated permission-management UI and
  operator scripts.
- Add one-time client secret reveal and regeneration for confidential/service
  clients.
- Add redirect URI validation policy for local, preview, staging, and
  production.
- Add third-party ownership, partner review, TOS/contact metadata, and
  production approval queue.

## Validation Commands

- `pnpm --filter @forge/developer lint`
- `pnpm --filter @forge/developer typecheck`
- `pnpm --filter @forge/developer test`
- `pnpm --filter @forge/auth test -- apps scopes seed-first-party-apps`
