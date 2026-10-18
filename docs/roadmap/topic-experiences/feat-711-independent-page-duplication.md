---
id: "feat-711"
title: "Independent unpublished page duplication with working draft preview"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-15"
duration: 2
depends_on: []
blocks:
  - "feat-712"
tags:
  - "cms"
  - "admin"
  - "graphql"
  - "web"
---

## Problem

Duplicating an Experience (feat-405) creates canonical `DRAFT` locale rows with
no active `ContentRevision`, so the copy has no preview capability until its
first save. The Watch homepage cannot be duplicated at all: duplication and
every later draft save validate homepage-only blocks (`watchHomeCategoryRail`,
the dynamic infinite collection) against `isHomepage`, which a copy must never
inherit because `isHomepage` is also the live homepage assignment. The copied
source version (saved draft vs canonical) is implicit.

## Entry Points — Read These First

1. `apps/admin/src/services/experience.service.ts` — `duplicate`,
   `stageLocaleDraft`, `publishLocale`, `assertHomepageBlockPlacement`.
2. `apps/admin/src/services/experience.schemas.ts` —
   `ExperienceLocaleDraftDataSchema`, `DuplicateExperienceInput`.
3. `apps/admin/src/services/experience-preview.service.ts` and the
   `ExperiencePreview` type in `apps/admin/src/graphql/types/experience.ts`.
4. `apps/admin/src/services/watch-setting.service.ts` — live homepage
   assignment (`isHomepage` + `PUBLISHED`).
5. `apps/web/src/app/(preview)/preview/experience/[token]/page.tsx` and
   `apps/web/src/lib/experience-preview.ts`.
6. `docs/plans/2026-10-15-009-feat-independent-page-duplication-plan.md`.

## Grep These

- `assertHomepageBlockPlacement`
- `homepageLayout`
- `sourceVersion`
- `resolveWatchHomeCategoryRailReadBlocks`

## What To Build

1. `ExperienceLocale.homepageLayout` (migration `0154`), part of the draft
   snapshot, meaning "render with the Watch home layout and allow homepage-only
   blocks" without assigning the live homepage. Context =
   `isHomepage || homepageLayout`.
2. `ExperienceService.duplicate({ id, sourceVersion })` with
   `sourceVersion: "EFFECTIVE" | "CANONICAL"` (default `EFFECTIVE`). One
   `REPEATABLE READ` transaction creates the copy, its canonical draft rows and
   one active draft revision (fresh preview token) per locale; reports
   `copiedFrom` and `sourceDraftRevision` per locale.
3. Draft saves validate against the context; publish validates against
   assignment.
4. Preview exposes `homepageLayout`; Web selects the Watch home renderer from
   the context and labels the banner, with a schema-lag fallback to `false`.
5. GraphQL `duplicateExperience(id, sourceVersion)`; MCP
   `experience.duplicate` `sourceVersion` + per-locale metadata.

## Constraints

- Never set `isHomepage` on a copy; never publish, revalidate, refresh the
  route manifest, or embed during duplication.
- `write:experiences` before any source read; source `canViewExperience`
  before any write.
- Keep `expectedDraftRevision` (null = no draft; opaque revision = CAS) and
  discard/preview-token retirement semantics unchanged.
- Regenerate `apps/admin/schema.graphql` and
  `packages/admin-graphql/src/admin-graphql-env.d.ts`; never hand-edit.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/services/experience.service.test.ts src/services/experience-mcp.service.test.ts src/services/experience-preview.service.test.ts src/app/mcp/route.test.ts src/graphql/schema.test.ts`
- `pnpm --filter @forge/web exec vitest run src/lib/experience-preview.test.ts`
- `pnpm --filter @forge/admin schema:print && pnpm --filter @forge/admin-graphql generate`
- typecheck + lint for `@forge/admin`, `@forge/admin-graphql`, `@forge/web`.
