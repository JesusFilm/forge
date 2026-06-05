---
title: Port the beta watch home carousel to Forge
type: implementation-plan
status: ready
date: "2026-06-05"
roadmap: docs/roadmap/platform/feat-159-watch-home-beta-carousel.md
---

# Port the beta watch home carousel to Forge

## Goal

Replace the current Forge watch home intro with the beta JesusFilm.org watch experience: a black, TV-like, autoplaying hero carousel with playable media, a thumbnail rail, skip/mute/progress controls, and mobile behavior that stays close to the supplied desktop screenshot and the live beta reference.

The implementation must be Forge-native. It should use Forge styles and components, source content from admin GraphQL, and avoid importing the upstream Core watch app directly.

## Inputs

- User request and attached screenshot for the target first viewport.
- Roadmap ticket: `docs/roadmap/platform/feat-159-watch-home-beta-carousel.md`
- Forge home route: `apps/web/src/app/[locale]/[htmlLang]/page.tsx`
- Forge catch-all language home route: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- Forge watch content resolver: `apps/web/src/lib/content.ts`
- Current Forge carousel pattern: `apps/web/src/components/sections/NavigationCarousel.tsx`
- Current Forge video background pattern: `apps/web/src/components/sections/VideoHero.tsx`
- Current rich player logic reference: `apps/web/src/components/watch/HeroPlayer.tsx`
- Admin video GraphQL type: `apps/admin/src/graphql/types/video.ts`
- Admin video service filters: `apps/admin/src/services/video.service.ts`
- Admin typed client guidance: `packages/admin-graphql/CLAUDE.md`
- Upstream beta behavior source:
  - `apps/watch/src/components/PageMain/PageMain.tsx`
  - `apps/watch/src/components/PageMain/useWatchHeroCarousel.ts`
  - `apps/watch/src/components/PageMain/ContainerWithMedia/ContainerWithMedia.tsx`
  - `apps/watch/src/components/VideoCarousel/VideoCarousel.tsx`
  - `apps/watch/src/components/VideoCarouselCard/VideoCarouselCard.tsx`
  - `apps/watch/src/components/VideoHero/libs/useCarouselVideos/useCarouselVideos.ts`
  - `apps/watch/config/video-playlist.json`
  - `apps/watch/config/video-inserts.mux.json`

## Research Findings

- The linked `apps/watch-modern` package on `JesusFilm/core@main` is currently scaffold-like and does not contain the screenshot carousel. The screenshot-matching beta carousel source is in the legacy `apps/watch` package under `PageMain`, `VideoCarousel`, and `VideoHero/libs/useCarouselVideos`.
- Forge already has a watch home entry route that resolves `watchSetting(locale).homepageExperience` and renders block sections.
- Forge already has Embla carousel conventions and bleed-alignment constants in section components; use those instead of upstream Swiper.
- Forge already uses `@forge/video-player/mux-video` for background-style hero video and a richer `HeroPlayer` for watch pages; the home carousel should borrow control/state ideas, not embed the full watch-page player.
- Admin `VideoListInput` already supports category, collection, language, search, sort, limit, and offset at the service layer. The GraphQL `videos` resolver currently exposes only `limit` and `offset`, so the PR likely needs a small admin schema expansion plus regenerated typed client output.
- Existing watch route builders must stay in charge of public video links so audio language slugs remain correct.

## Assumptions

- The first PR should port the top hero carousel and immediate thumbnail rail, not the entire upstream below-the-fold `CollectionsRail` page.
- Static Forge config for upstream playlist IDs and Mux insert definitions is acceptable for this slice, provided the PR documents the admin editorial-data gap for follow-up.
- If an upstream playlist collection ID is not represented in admin or has no playable active-language video, the carousel can skip it and fill from admin short films or a general playable pool.
- The existing floating search redesign remains the search surface for watch home; this work should not re-port upstream Algolia `SearchComponent`.
- The visual target is parity in layout, motion model, and control behavior, not pixel-perfect reuse of upstream CSS.

## Requirements

- The `/watch` home first viewport must use a black page shell, wide hero media, bottom-left play CTA, content label/title, next and mute controls, and an active thumbnail rail similar to the screenshot.
- Mobile must be intentionally designed, with stable height, readable title/CTA, reachable controls, and a horizontal thumbnail rail that does not cause text overlap.
- Carousel cards must be keyboard/click selectable, expose meaningful labels, and keep the selected card visually distinct.
- The active hero video must autoplay muted when possible, track progress, and auto-advance near completion. Manual next/skip must advance to the next slide.
- Mux insert slides from upstream config must be supported as non-admin editorial inserts for this first slice.
- Video slides must come from admin data, including playable HLS/Mux playback, image URLs, title, label, duration, and route slug.
- Public links must use the active or fallback audio language slug through existing watch route helpers.
- Existing below-the-fold homepage blocks must remain available unless they duplicate the new hero too aggressively; any skipped block behavior must be explicit and tested.
- Any missing admin/source data must be written down for follow-up PRs.

## Design And Architecture

### Admin GraphQL

Expose the already-supported video list filters at the GraphQL boundary:

- `category: String`
- `collection: String`
- `language: String`
- `search: String`
- `sort: VideoSort`
- existing `limit` and `offset`

The resolver should pass these through to `VideoService.list`. If `VideoSort` is not already part of the public SDL, add the smallest enum that matches the service contract. Regenerate:

- `apps/admin/schema.graphql`
- `packages/admin-graphql/src/admin-graphql-env.d.ts`

Avoid changing admin data models in this PR.

### Web Data Resolver

Add a server-side resolver in `apps/web/src/lib/watch-home-carousel.ts` that:

- Accepts the locale and active language slug.
- Requests short film and configured collection pools from admin with bounded limits.
- Normalizes videos into `WatchHomeCarouselVideoItem`.
- Chooses the best playable variant for the active language, then a safe fallback language.
- Builds watch links with existing route helpers.
- Merges static Mux insert items from a Forge config module.
- Returns a compact list of initial slides and a missing-data report object for logging/tests/follow-up docs.

Keep any upstream playlist IDs and Mux insert definitions in a Forge-owned module, for example:

- `apps/web/src/lib/watch-home-carousel-config.ts`

### Client State

Add a focused client hook, for example:

- `apps/web/src/components/watch-home/useWatchHomeCarousel.ts`

Responsibilities:

- Track `activeSlideId`, `isMuted`, `progress`, and current video element state.
- Auto-advance when progress crosses the same near-complete threshold as upstream, around 95 percent.
- Advance on ended, Mux insert completion, or explicit next.
- Allow manual thumbnail selection without layout jump.
- Pause progress tracking cleanly when the active slide changes.

Keep player state local to the home hero. Do not couple it to watch-page `PlayerProvider` unless a small reusable helper is already available.

### Visual Components

Add Forge-native components under:

- `apps/web/src/components/watch-home/WatchHomePage.tsx`
- `apps/web/src/components/watch-home/WatchHomeHero.tsx`
- `apps/web/src/components/watch-home/WatchHomeRail.tsx`
- `apps/web/src/components/watch-home/WatchHomeCard.tsx`

Component rules:

- Use Tailwind and existing UI primitives.
- Use Embla for the rail.
- Use `next/image` for card artwork.
- Use `@forge/video-player/mux-video` or a plain `video` element only through existing player package conventions.
- Use icon buttons for play, next, mute, and language/search-adjacent controls where applicable.
- Avoid nested cards, oversized marketing copy, one-note palettes, and text that can overflow at mobile widths.

### Route Integration

Update the watch home route so the new page renders at:

- `apps/web/src/app/[locale]/[htmlLang]/page.tsx`
- any one-segment language home branch in `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`

The route should still resolve the current watch homepage experience for below-the-fold blocks when useful. If the first existing block is a legacy hero/navigation block that duplicates the new intro, filter it with an explicit helper and a focused test.

## Implementation Steps

1. Add or update the admin GraphQL `videos` args so web can query category, collection, language, search, and sort through the typed admin client.
2. Regenerate admin schema and `packages/admin-graphql` typed output if step 1 changes SDL.
3. Add Forge watch home carousel config for upstream playlist IDs and Mux insert definitions.
4. Add the server resolver and normalizer for admin-backed carousel items.
5. Build the client carousel hook and visual components.
6. Wire the new home component into the root and language home routes.
7. Add missing-data follow-up documentation or roadmap tickets for gaps discovered while mapping upstream sources to admin fields.
8. Add focused unit/component tests for the resolver, slide sequencing, route generation, progress advance, and mobile-safe rendering assumptions.
9. Run targeted validation and Helium visual smoke for desktop and mobile.

## Test Plan

- Admin schema/type generation:
  - Run the repo command used for admin GraphQL schema generation if SDL changes.
  - Run the typed client generation command for `packages/admin-graphql`.
- Unit tests:
  - `apps/web/src/lib/watch-home-carousel*.test.ts`
  - `apps/web/src/components/watch-home/useWatchHomeCarousel*.test.tsx`
  - existing route/content tests impacted by the home route.
- Focused validation:
  - `pnpm --filter @forge/web test`
  - `pnpm --filter @forge/web typecheck`
  - relevant admin/package tests or typecheck when GraphQL SDL changes.
- Browser proof with Helium:
  - Desktop `/watch` at the screenshot-like viewport.
  - Mobile `/watch` around `390x844`.
  - Confirm hero media renders, rail scrolls, next/mute work, play link routes, and no text/control overlap.

## Missing Data Follow-Up List

Create follow-up tickets or docs for:

- Admin-owned home carousel playlist and insert configuration.
- Admin-owned Mux insert metadata: overlay labels, action URLs, logos, time-of-day copy, and schedule rules.
- Admin image parity for upstream local thumbnail overrides and blurhash placeholders.
- Admin collection count/pool endpoints to avoid broad client overfetch and better preserve upstream daily selection.
- Full admin-backed below-the-fold `CollectionsRail` parity.
- Stronger language fallback rules for videos with partial dub/variant coverage.

## Done Criteria

- The new Forge watch home carousel is rendered from admin-backed data.
- Desktop and mobile visual smoke match the supplied beta direction closely enough for review.
- Missing upstream/admin parity gaps are documented for follow-up PRs.
- Roadmap ticket `feat-159` is complete or has precise remaining blockers before PR handoff.
