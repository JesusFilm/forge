---
id: feat-154
title: Variant-aware watch content language identity
status: "in-progress"
priority: high
area: platform
tags:
  - admin
  - web
  - watch-page
  - core-sync
  - i18n
depends_on:
  - feat-153
blocks: []
---

## Problem

`feat-153` added the first end-to-end plan and implementation path for
localized watch content metadata from Core. Follow-up review found one contract
gap: the first approach still treats BCP-47 `locale` as if it uniquely
identifies localized video content.

That is not safe. Core/Admin can have two or more distinct language variants
with the same BCP-47 tag. The app cannot collapse accents or variants into one
content language. At the same time, public watch URLs should not switch to Core
language ids. The correct identity split is:

- public exact selector: `Language.slug` / `languageSlug`
- broad grouping and fallback selector: `Language.bcp47` / `locale`
- internal storage/provenance selector: admin `Language.id`, backed by
  `Language.coreId`

## Plan

- Implementation plan:
  `docs/plans/2026-06-01-003-feat-watch-language-variant-identity-plan.md`

## Entry Points

- `apps/admin/prisma/schema.prisma`
- `apps/admin/src/services/core-sync/video-localized-metadata.ts`
- `apps/admin/src/services/core-sync/transforms.ts`
- `apps/admin/src/graphql/types/video.ts`
- `apps/web/src/lib/fragments/watch-video.ts`
- `apps/web/src/lib/content.ts`
- `apps/mobile/src/lib/queries.ts`
- `packages/admin-graphql/src/admin-graphql-env.d.ts`

## What To Build

Update localized watch content storage, sync, GraphQL, and rendering so one
video can have multiple localized content variants with the same BCP-47 tag.
Keep `locales(locale: "ru")` working as a broad query that can return multiple
rows, and add `languageSlug` as the exact public variant selector for watch
rendering.

Web should query exact content with both `locale` and `languageSlug`, then fall
back to broad BCP-47 content and finally English. Core sync and backfill should
upsert/stale rows by language identity, not locale alone.

## Constraints

- Do not collapse same-BCP47 Core language variants into one row.
- Do not make Core language id the public route or required GraphQL selection
  identity.
- Preserve public watch URL shape and existing language slug routing.
- Preserve broad BCP-47 GraphQL behavior for existing callers.
- Keep admin as the runtime source for web/mobile/TV; do not add direct Core
  fallback reads to consumers.
- Regenerate admin SDL and admin-graphql generated types with schema changes.

## Verification

- Admin schema/migration tests prove duplicate BCP-47 variants can exist for
  one video.
- Core sync tests prove same-BCP47 variants create/update separate rows and do
  not overwrite each other by locale fallback.
- Admin GraphQL tests prove `locales(locale: "ru")` is broad and
  `locales(locale: "ru", languageSlug: "russian")` is exact.
- Web tests prove route language slug is sent as `languageSlug` while BCP-47 is
  sent as `locale`.
- Mobile/generated-client validation proves copied watch fragments still
  compile and normalize broad locale responses safely.
- Backfill smoke proves the reference Russian route and at least one
  non-Russian localized route render localized catalog content without treating
  the implementation as Russian-only.
