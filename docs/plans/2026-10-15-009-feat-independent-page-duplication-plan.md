---
title: "Independent unpublished page duplication with working draft preview"
type: feat
status: active
date: 2026-10-15
roadmap: feat-711
---

# Independent unpublished page duplication with working draft preview

## Problem

`ExperienceService.duplicate` (feat-405) copies every locale into canonical
`DRAFT` rows and creates no `ContentRevision`. Three defects follow:

1. **No preview.** The preview capability lives on the active draft revision
   (`ExperiencePreviewService.resolveByToken`). A fresh copy has no draft, so it
   has no preview URL until someone saves it.
2. **The homepage cannot be duplicated.** Duplicate validates every copied
   locale with `assertWatchHomeCategoryRailPlacement(blocks, false)`, so the
   live Watch homepage (which carries a category rail) fails with
   `ExperienceWatchHomeCategoryRailPlacementError`. Even if it passed, every
   later save of the copy would fail the same check because the copy has
   `isHomepage: false`, and the dynamic infinite-collection block would fail
   `assertDynamicCollectionPlacement` likewise.
3. **The copied version is implicit.** Duplicate prefers the active saved draft
   and nothing tells the caller which version it copied.

`isHomepage` currently means two things: the live homepage ASSIGNMENT (the
public `watchSetting` resolver picks the newest PUBLISHED `isHomepage` locale)
and the homepage RENDERING CONTEXT (block placement validation, editor block
picker, category-rail read synthesis, and Web's preview renderer choice). A copy
must have the second without the first.

## Key decisions

- **KTD1 — separate rendering context from assignment.** Add a locale-owned
  authored field `homepageLayout: Boolean` (`experience_locale.homepage_layout`,
  default `false`, additive migration `0154`). It is part of
  `ExperienceLocaleDraftDataSchema` (`.default(false)` so older snapshots and
  SEO partial snapshots still parse). The homepage rendering context is
  `isHomepage || homepageLayout`. `isHomepage` keeps meaning live assignment
  only; nothing in this change sets it.
- **KTD2 — where each meaning applies.**
  - Draft saves (`stageLocaleDraft`) validate homepage-only block placement
    against the context, so a homepage copy stays editable.
  - Publish rejects any `homepageLayout && !isHomepage` draft, even if its
    homepage-only blocks were removed. Draft updates may repeat the stored
    layout context but cannot change it. A homepage copy therefore remains
    homepage-layout content: it can publish only while explicitly assigned as
    the homepage, including after any later unassignment.
  - Preview read projection (category-rail synthesis) and Web renderer
    selection use the context.
  - Public `ExperienceLocale.blocks` read projection keeps `isHomepage`.
- **KTD3 — duplication stages a real draft.** In one transaction per call,
  duplicate creates the new Experience, its canonical `DRAFT` locale rows with
  the copied content (`isHomepage: false`, `homepageLayout` = source context,
  `publishedAt: null`), and one active `ContentRevision` `DRAFT` per locale whose
  complete snapshot equals the copied content, with a fresh preview token and
  the caller's attribution. Canonical content is kept (not a stub) so discarding
  the copy's draft returns to the as-duplicated content instead of an empty
  page. The copy's preview works immediately; publish/discard/expected-revision
  contracts are the existing ones.
- **KTD4 — explicit source version.** Input gains
  `sourceVersion: "EFFECTIVE" | "CANONICAL"` (default `EFFECTIVE`, preserving
  feat-405 behaviour). `EFFECTIVE` copies each locale's active saved draft when
  one exists, otherwise its canonical row. `CANONICAL` copies the stored
  canonical row only (for a published locale, the live published content).
  Unsaved editor state is never visible to the service. The result reports, per
  locale, `copiedFrom: "ACTIVE_DRAFT" | "CANONICAL"` and the opaque
  `sourceDraftRevision` (`localeDraftRevision`) that was read, or `null`.
- **KTD5 — consistent read.** Source rows and drafts are read inside the same
  `REPEATABLE READ` transaction as the writes, so a concurrent source save or
  publish cannot produce a copy mixing two versions. The source is never written.
- **KTD6 — authorization order unchanged.** `write:experiences` before any
  source read; `canViewExperience` on the source before any write; caller owns
  the copy.
- **KTD7 — Web compatibility.** Web reads `homepageLayout` through a separate
  small preview query run in parallel with the existing fallback ladder. An
  Admin that predates the field answers with the validation error
  `Cannot query field "homepageLayout" on type "ExperiencePreview"`, which Web
  treats as `false` (renders exactly as today). The existing ladder is untouched.

## Scope

Admin: schema + migration, schemas, service (duplicate, stage, publish,
restore selects), preview service + GraphQL preview type, GraphQL
`duplicateExperience(sourceVersion)` arg + enum, `ExperienceLocale` /
`ExperienceLocaleEffective.homepageLayout` (permissioned), MCP
`experience.duplicate` `sourceVersion` + result metadata, editor block picker
uses the context and shows a "Homepage layout · not the live homepage" note,
editor Duplicate tooltip states the copied version.

Web: preview layout probe + renderer selection + banner label.

Generated: `apps/admin/schema.graphql`,
`packages/admin-graphql/src/admin-graphql-env.d.ts`, Prisma client.

## Non-goals

- No UI to assign or unassign the live homepage (unchanged; not in the editor
  today).
- No change to which row the public homepage resolver picks.
- No copying of revisions history, embeddings, chats, publication, assignment.
- No live duplication of production content.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/services/experience.service.test.ts src/services/experience-mcp.service.test.ts src/services/experience-preview.service.test.ts src/app/mcp/route.test.ts src/graphql/schema.test.ts src/app/dashboard/experiences/duplicate-experience-action.test.ts`
- `pnpm --filter @forge/web exec vitest run src/lib/experience-preview.test.ts "src/app/(preview)/preview/experience/[token]/page.test.tsx"`
- `pnpm --filter @forge/admin schema:print`, `pnpm --filter @forge/admin-graphql generate`, typecheck + lint for admin, admin-graphql, web.
- Real-Postgres duplicate → preview → edit → discard round trip only if a
  disposable database is available (none assumed).
