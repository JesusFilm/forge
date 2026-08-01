---
id: "feat-323"
title: "Add localized Watch video search and social metadata"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-31"
duration: 1
depends_on: []
blocks:
  - "feat-324"
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch-page"
  - "seo"
  - "i18n"
---

## Problem

Playable Watch pages derive search and social metadata from the visible localized video title and description. Editors cannot improve crawler intent or social presentation without changing the audience-facing video identity, and they cannot select a dedicated managed social image.

## Entry Points — Read These First

1. `apps/admin/prisma/schema.prisma` — localized `VideoLocale` ownership and Media Library relations.
2. `apps/admin/src/graphql/types/video.ts` — public video-locale GraphQL projection.
3. `apps/admin/src/app/dashboard/videos/video-detail-page.tsx` — current video detail surface.
4. `apps/admin/src/services/video.service.ts` — Watch route snapshot and localized video projection.
5. `apps/web/src/lib/fragments/watch-video.ts` — typed Watch video selection.
6. `apps/web/src/lib/experience-metadata.ts` — document, Open Graph, Twitter, and structured-data metadata generation.

## Grep These

- `VideoLocale`
- `WatchRouteSnapshotLocale`
- `generateWatchVideoMetadata`
- `emitRevalidateWebhook`
- `ImagePickerBrowser`

## What To Build

1. Add nullable localized Search title, Search description, and managed Media Library social image ownership to `VideoLocale` without changing its visible title or description.
2. Add an authenticated Admin editor that can save and clear those fields for each video locale.
3. Preserve editor-owned metadata during Core sync and emit Watch revalidation after a successful update.
4. Expose the overrides through the committed Admin GraphQL schema and generated `@forge/admin-graphql` contract.
5. Use the override text for HTML, Open Graph, and Twitter metadata while preserving canonical, robots, locale, site name, visible copy, and `VideoObject` identity.
6. Fall back to the current localized video copy and Mux/poster/site image chain when overrides are absent.
7. Initialize the English JESUS locale with the approved Search title and description without changing its visible video record.

## Constraints

- Social image overrides must reference managed Media Library assets; do not accept arbitrary external URLs.
- Keep metadata localized per `VideoLocale` and do not add a separate SEO publication lifecycle.
- Core sync must never overwrite editor-owned Search and Social fields.
- Do not change public Watch route identity, canonical policy, hreflang behavior, or structured `VideoObject.name`.
- Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts` after Pothos changes.

## Verification

- Focused Admin service, mutation, sync-preservation, and editor tests.
- Focused Web fragment, content-normalization, metadata-fallback, structured-data, and revalidation tests.
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- Touched-package typecheck, lint, format, and build checks.
- Browser proof that a saved locale renders the override in server HTML while the visible video title remains unchanged.

## Result

Implemented localized Search title, Search description, and managed social-image overrides on `VideoLocale` without changing visible video content. Admin now provides an exact-locale Search and Social editor with Media Library selection, dirty-state protection, race-safe locale loading, locale deep links, and fire-and-forget Watch revalidation. The public Watch snapshot, stable GraphQL locale contract, generated gql.tada client, Web normalization, and HTML/Open Graph/Twitter metadata all carry the overrides while `VideoObject` and visible copy keep their original identity.

Migration `0047_video_locale_search_social_metadata` initializes the canonical English JESUS row with the approved title and description and no image. `pnpm --filter @forge/admin verify:video-search-social-seed` is the read-only promotion check for exact candidate count and field values. The social-image projection preserves its real MIME type and falls back safely when a referenced image is unusable.

Validation completed with Admin/Web/Admin-GraphQL lint and typechecks, generated-schema drift checks, 168 focused Admin tests, 61 focused Web tests, the full Web suite, and the full Admin suite excluding the unrelated Windows `run-embeds` child-process test (its three baseline assertions return a null spawn status on this machine). Browser QA verified the Watch shell and Search open/close interaction with no console errors. Exact live JESUS server HTML could not be rendered in the local browser because the worktree has no valid Admin bearer/database environment; exact head-tag and visible/structured-data isolation remain covered by the passing metadata and route contract tests. Post-release indexing and CTR observation remains tracked by `feat-324`.
