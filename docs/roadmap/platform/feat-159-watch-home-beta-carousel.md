---
id: feat-159
title: Admin-backed watch home beta carousel
owner: urim
priority: high
status: "complete"
start_date: "2026-06-05"
duration: "4d"
depends_on:
  - feat-149
  - feat-150
blocks:
  - feat-160
tags:
  - web
  - watch
  - admin-graphql
  - design-system
---

# Admin-backed watch home beta carousel

## Problem

The Forge watch home page needs the beta JesusFilm.org watch hero experience: a TV-like autoplaying media intro, thumbnail rail, player controls, and mobile-first behavior. The upstream design currently lives in the Core watch app, but Forge must use its own design system and admin-backed data rather than Arclight queries, Algolia-specific home wiring, local image overrides, or Core app imports.

## Scope

- Replace the current top-of-home watch experience for `apps/web` with a Forge-native beta carousel intro.
- Source playable videos, labels, thumbnails, poster images, language slugs, variants, and watch links from `apps/admin` GraphQL through `packages/admin-graphql`.
- Preserve the existing global floating search behavior and watch route builders.
- Port the carousel/player behavior from the upstream beta source, including manual card selection, skip/next, mute, active progress, Mux insert slides, and auto-advance near completion.
- Use Forge CSS/design-system primitives, Embla carousel patterns, and `@forge/video-player/mux-video`; do not import Swiper, Material UI, or Core app components.
- Keep below-the-fold home content functional, but defer full upstream `CollectionsRail` parity to follow-up work unless it naturally fits the PR.

## Source References

- Current Forge home route: `apps/web/src/app/[locale]/[htmlLang]/page.tsx`
- Current watch content resolver: `apps/web/src/lib/content.ts`
- Current carousel pattern: `apps/web/src/components/sections/NavigationCarousel.tsx`
- Current video preview pattern: `apps/web/src/components/sections/VideoHero.tsx`
- Watch player logic to reuse carefully: `apps/web/src/components/watch/HeroPlayer.tsx`
- Admin video GraphQL type: `apps/admin/src/graphql/types/video.ts`
- Admin video list service filters: `apps/admin/src/services/video.service.ts`
- Admin typed client package: `packages/admin-graphql`

## Upstream Behavior To Port

The screenshot-matching beta carousel is implemented in the legacy Core watch app, not the current scaffolded `apps/watch-modern` package on `main`.

- `apps/watch/src/components/PageMain/PageMain.tsx`
- `apps/watch/src/components/PageMain/useWatchHeroCarousel.ts`
- `apps/watch/src/components/PageMain/ContainerWithMedia/ContainerWithMedia.tsx`
- `apps/watch/src/components/VideoCarousel/VideoCarousel.tsx`
- `apps/watch/src/components/VideoCarouselCard/VideoCarouselCard.tsx`
- `apps/watch/src/components/VideoHero/libs/useCarouselVideos/useCarouselVideos.ts`
- `apps/watch/config/video-playlist.json`
- `apps/watch/config/video-inserts.mux.json`

## Implementation Notes

- Expose the existing admin video list filters through GraphQL if the current public `videos` query cannot request category, collection, language, search, or sort. Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql` types in the same PR if the schema changes.
- Add a web-side carousel data resolver that fetches bounded admin video pools by language and collection/category, then normalizes the result into a small serializable payload for the client component.
- Keep upstream playlist and Mux insert definitions as Forge-owned config for the first PR, then document admin editorialization as follow-up work.
- Prefer admin `images`, `thumbnail`, `mobileCinematicHigh`, `mobileCinematicLow`, `muxVideo.playbackId`, `variant.hls`, `duration`, `label`, and localized title fields. Skip or fall back when a video is not playable in the active language.
- Use admin watch route builders so cards link to `/watch/{video}.html/{language}.html` with the active or fallback audio language slug.
- Preserve current page localization behavior for `/watch` and one-segment language home routes.

## Follow-Up Data Gaps

- Admin editorial model for home playlist ordering, Mux inserts, and rail definitions.
- Admin fields for Mux insert overlay metadata, action URLs, logo overlays, and time-of-day conditional copy.
- Admin image parity for upstream local thumbnail overrides, blurhash placeholders, and custom insert artwork.
- Count/pagination helpers for collection pools so the carousel can avoid broad overfetch while preserving daily/random selection behavior.
- Admin-backed full `CollectionsRail` parity below the hero.
- Language-specific playable-video selection rules for videos with multiple dubs and missing active-language variants.

## Verification

- Unit or component coverage for carousel sequencing, Mux insert merging, progress auto-advance, manual selection, skip, and route generation.
- Admin GraphQL/type generation validation if the schema changes.
- `apps/web` focused lint/typecheck/test validation for touched files.
- Local visual smoke in Helium for desktop and mobile viewports against the attached screenshot and the live beta reference when the beta cookie can be set.
