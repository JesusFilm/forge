---
id: "feat-092"
title: "Admin Experience Embedding Workflow and Safety Controls"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-04-14"
duration: 3
depends_on:
  - "feat-086"
blocks: []
tags:
  - "platform"
  - "admin"
  - "workflows"
  - "pgvector"
  - "security"
---

## Problem

The admin app has pgvector-backed semantic search over `ExperienceLocale`, but
no workflow currently generates embeddings for locale content. The write path
for the `embedding` column is also missing a defense-in-depth layer that strips
vector data out of ordinary Prisma results unless a caller explicitly opts in.

## Entry Points — Read These First

1. `docs/handoffs/2026-04-14-admin-app-v1-handoff.md` — remaining P0 backend scope after phase 7.
2. `apps/admin/src/services/experience.search.ts` — current read-side semantic search over `ExperienceLocale.embedding`.
3. `apps/admin/src/graphql/mutations/experience.ts` — current experience mutation surface and auth pattern.
4. `apps/admin/src/auth/permissions.ts` — `canEditExperienceLocale`, `canWriteDerived`, and workflow permission gates.
5. `apps/admin/src/db/client.ts` and `src/db/pgvector.ts` — Prisma singleton and vector SQL helper seam.
6. `apps/manager/src/services/embeddings.ts` and `src/workflows/videoEnrichment.ts` — repo-local reference patterns for embeddings and `"use workflow"`/`"use step"` structure.

## Grep These

- `embedding` in `apps/admin/src/graphql/`, `apps/admin/src/services/`, and `apps/admin/prisma/schema.prisma`
- `canEditExperienceLocale|canWriteDerived|system:trigger-workflow` in `apps/admin/src/`
- `"use workflow"|"use step"` in `apps/manager/src/workflows/`
- `toPgVector|<=>|::vector` in `apps/admin/src/`

## What To Build

1. Add `src/services/embeddings.service.ts` that generates a single 1536-dimension embedding from normalized `ExperienceLocale` text using the configured provider env.
2. Add `src/workflows/experienceEmbedding.ts` with a `"use workflow"` entry point that:
   - loads the target `ExperienceLocale`
   - builds the embedding input from title + block text
   - generates the embedding
   - writes it via raw SQL with `::vector`
3. Add `triggerExperienceEmbedding(localeId: ID!)` to `src/graphql/mutations/experience.ts`.
4. Enforce auth so ADMIN may trigger any locale and EDITOR may trigger only locales they own.
5. Add a Prisma client extension in `src/db/client.ts` that strips `embedding` from returned rows unless the caller opts in with an explicit include flag for workflow/internal code.
6. Add focused tests for:
   - embedding input normalization
   - mutation/workflow auth behavior
   - Prisma embedding stripping and opt-in bypass

## Constraints

- Keep this ticket headless: no dashboard or UI work.
- Do not expose vector columns in GraphQL.
- Do not add direct `process.env` reads; extend `src/config/env.ts`.
- The derived embedding write path must check `canWriteDerived`.
- Raw vector writes must cast through `::vector`; do not rely on Prisma model writes for the unsupported column.

## Verification

- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin build`
- `triggerExperienceEmbedding` compiles into the schema without exposing any embedding-shaped GraphQL fields.
