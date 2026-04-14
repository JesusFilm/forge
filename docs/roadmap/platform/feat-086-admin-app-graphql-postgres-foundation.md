---
id: "feat-086"
title: "Admin App GraphQL + Postgres Foundation"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-04-13"
duration: 21
depends_on:
  - "feat-022"
blocks:
  - "feat-091"
tags:
  - "platform"
  - "cms"
  - "graphql"
  - "prisma"
  - "auth"
  - "pgvector"
---

## Problem

Strapi no longer fits the long-term editorial and AI-operations direction for Forge. The platform needs a first-party admin surface with its own GraphQL API, Prisma/Postgres schema, auth system, revision history, permissions model, and workflow engine so content operations can evolve without being constrained by Strapi's plugin boundaries.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md` — source requirements for the admin replacement.
2. `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md` — canonical implementation sequence across Units 1-13.
3. `apps/admin/AGENTS.md` — package-level execution map and architecture rules.
4. `apps/admin/CLAUDE.md` — current build status, auth expectations, permission conventions, and data-model decisions.
5. `apps/admin/prisma/schema.prisma` — current canonical schema for content, revisions, and future auth tables.
6. `apps/admin/src/graphql/` — current Yoga + Pothos read architecture that Units 5-9 progressively harden.
7. `docs/solutions/cms/admin-app-data-model-decisions.md` — durable rationale for Unit 4 data modeling.
8. `docs/solutions/graphql/pothos-prisma-shared-enum-module.md` — shared enum/scalar registration pattern already established in this app.
9. `docs/solutions/auth/spike-auth-header-must-be-env-gated.md` — auth hardening rule from Unit 6 review.

## Grep These

- `Unit 5:` in `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md`
- `x-spike-role|createContext|authScopes` in `apps/admin/src/`
- `ContentRevision|RevisedByKind|LocaleStatus` in `apps/admin/`
- `betterAuth|prismaAdapter|createAuthEndpoint|socialProviders` in `apps/admin/`
- `firebase|signInWithPassword|verifyIdToken|FIREBASE_` in `apps/admin/`
- `FACEBOOK_CLIENT_ID|FACEBOOK_CLIENT_SECRET|provider=facebook` in `apps/admin/`
- `REDIS_HOST|REDIS_PORT|REDIS_PASSWORD|rateLimitAuthRoute` in `apps/admin/`
- `DataLoader|classification` in `apps/admin/src/graphql/`

## What To Build

1. Build `apps/admin/` as the new editorial/admin control plane using Next.js, GraphQL Yoga, Pothos, Prisma, PostgreSQL, pgvector, Better Auth, and useworkflow.
2. Keep Strapi serving existing consumers during the migration; the admin app is additive until explicit cutover work lands.
3. Sequence delivery through the units already defined in the admin-app plan, keeping each architectural bet verified before more layers stack on top.
4. Preserve the boundary that reads flow through Pothos + Prisma, while mutations, raw SQL, sync, and ABAC live in services and workflows.
5. Capture non-obvious implementation patterns in `docs/solutions/` as units land.

## Constraints

- Do NOT import runtime code from `apps/web`, `apps/mobile`, `apps/mobile-v2`, `apps/cms`, or `apps/manager` into `apps/admin`.
- Do NOT expose vector columns in GraphQL types.
- Do NOT allow HTTP request headers to mint SYSTEM or privileged principals in production.
- Do NOT bypass services for mutations once Unit 7 lands.
- Do NOT add direct `process.env` reads; extend `apps/admin/src/config/env.ts`.

## Verification

- `pnpm --filter @forge/admin db:generate`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin build`
- For migration-shape units: apply the SQL to a disposable Postgres DB and inspect tables/indexes/constraints.
- For auth units: verify real session resolution replaces the spike-header path and that production ignores any spike header.
