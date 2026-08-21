---
id: "feat-405"
title: "Experience duplication across Admin, GraphQL, and MCP"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "cms"
  - "admin"
  - "graphql"
  - "i18n"
---

## Problem

Editors can create and edit Experiences, but cannot make a safe working copy of an existing Experience. Admin users, GraphQL API clients, and MCP agents need one consistent duplication operation that copies every locale and its authored content without accidentally publishing the copy.

## Entry Points — Read These First

1. `apps/admin/src/services/experience.service.ts` — Experience mutation and ABAC boundary.
2. `apps/admin/src/graphql/mutations/experience.ts` — GraphQL mutation registration.
3. `apps/admin/src/services/experience-mcp.service.ts` — experience-level MCP service.
4. `apps/admin/src/mcp/admin-mcp-tools.ts` and `apps/admin/src/app/mcp/route.ts` — MCP catalogue and dispatch.
5. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` and `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — editor server actions and visible controls.

## Grep These

- `class ExperienceService`
- `createExperience`
- `experience.create`
- `ExperienceEditor`
- `publishExperienceLocale`

## What To Build

1. Add `ExperienceService.duplicate` as the shared mutation path. It copies all source locales and authored fields into a new Experience owned by the caller.
2. Every copied locale must start as `DRAFT` with `publishedAt: null` and `isHomepage: false`; the new canonical must be active, preserve template classification, and belong to the caller.
3. Give copied locale slugs deterministic available `-copy` suffixes so the draft is distinguishable and can later be published without colliding with active content.
4. Expose `duplicateExperience(id: ID!): Experience!` in GraphQL.
5. Expose `experience.duplicate` in MCP using `experience:read` plus `experience:create`, returning the copied Experience, locales, and editor URL.
6. Add a visible Duplicate action to the Admin Experience editor and navigate to the new draft after success.

## Constraints

- Do not copy publication state, homepage designation, embeddings, revisions, or chat threads.
- Do not emit public revalidation or embedding side effects; duplication creates drafts only.
- Preserve all authored locale content, including blocks, route prefix, SEO, and OG fields.
- Apply read authorization to the source and write authorization to the new Experience; the caller becomes owner.
- Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts` after the Pothos change.

## Verification

- `pnpm --filter @forge/admin test -- src/services/experience.service.test.ts src/services/experience-mcp.service.test.ts src/app/mcp/route.test.ts src/graphql/schema.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin-graphql typecheck`
- Confirm a duplicated published, multi-locale Experience preserves the source template classification and opens as an active Experience whose locales are all drafts with unique copy slugs.
