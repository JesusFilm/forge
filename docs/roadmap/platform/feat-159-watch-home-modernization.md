---
id: "feat-159"
title: "Watch home modernized admin catalog"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-04"
duration: 4
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "admin"
  - "watch-page"
  - "catalog"
  - "ui"
---

## Problem

The Forge `/watch` home still renders the configured admin homepage Experience
as a generic SDUI page. The current Jesus Film watch home beta presents a richer
catalog surface: floating search, a cinematic hero carousel, source-driven rails
and grids, and a mission promo section. Forge needs that visual direction while
staying inside the local Tailwind/design system and reading content from admin
GraphQL instead of Core/Algolia/watch-local data.

## Entry Points - Read These First

1. `docs/plans/2026-06-04-003-feat-watch-home-modernization-plan.md` -
   implementation plan and source-data gap list.
2. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` - current watch home route.
3. `apps/web/src/components/FloatingSearchProvider.tsx` and
   `apps/web/src/components/SearchOverlay.tsx` - existing floating search chrome.
4. `apps/web/src/lib/content.ts` and `apps/web/src/lib/fragments/watch-video.ts`
   - current admin-backed watch video normalization patterns.
5. `apps/admin/src/graphql/types/video.ts` and
   `apps/admin/src/services/video.service.ts` - admin Video query surface.
6. `packages/admin-graphql/src/fragments/` - generated admin GraphQL fragment
   package used by web.
7. External source:
   `https://github.com/JesusFilm/core/tree/main/apps/watch-modern` and
   `https://github.com/JesusFilm/core/tree/main/apps/watch/src/components/PageMain`.

## Grep These

- `resolveWatchPage`
- `watchSetting(locale`
- `FloatingSearchProvider`
- `SearchOverlay`
- `watchVideoFragment`
- `Video.durationSeconds`
- `videos(limit`
- `videoBySlug`
- `collectionShowcaseSources`

## What To Build

1. Replace the generic home-only SDUI renderer with a modern watch home
   composition that preserves the existing floating search system.
2. Add the minimal admin PUBLIC GraphQL query surface needed for ordered
   showcase videos by Core id, including locale-narrowed titles, images,
   playable dub data, children, and child durations.
3. Add a Forge web home data resolver that maps admin videos into hero slides,
   rails, grids, and card metadata with public `/watch` URLs built by
   `apps/web/src/lib/routes.ts`.
4. Port the visual design into Forge Tailwind/components without importing MUI,
   Swiper, Algolia, or `@core/shared` UI packages from the external app.
5. Document any source-design data that admin cannot provide yet, especially
   watch-local thumbnail overrides, Mux inserts, collection metadata gaps, and
   beta-specific cookie routing if it cannot be reproduced locally.

## Constraints

- Web reads content through admin GraphQL only; do not add direct Core API,
  Algolia, or `apps/watch` runtime dependencies.
- Do not hand-edit generated `admin-graphql-env.d.ts` files.
- Preserve public `/watch` URL shape and language-slug URL builders.
- Keep this PR scoped to the watch home route, admin query widening, typed
  client updates, focused tests, and missing-data documentation.
- Do not replace dedicated video, series, search, download, language, or
  question-panel surfaces.
- Use Helium browser for local visual smoke where available.

## Verification

- `pnpm --filter @forge/admin test -- src/graphql`
- `pnpm --filter @forge/admin typecheck`
- Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql` outputs
  after the admin schema change.
- `pnpm --filter @forge/web test -- watch-home`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Local visual smoke of `/watch` at desktop and mobile widths, compared against
  the beta/reference screenshot and source page structure.
