---
id: "feat-275"
title: "Web Video Thumbnail White Interaction Frame"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "experience"
  - "ui"
  - "design-system"
---

## Problem

Interactive video thumbnails use several competing hover and keyboard-focus
treatments: red gradients, native outlines, amber rings, and local white
borders. The approved design-system treatment is one continuous inset 4px
solid-white frame, shared by pointer hover and keyboard focus, with no duplicate
native outline or colored glow.

## Entry Points - Read These First

1. `apps/web/src/components/ui/video-thumbnail-interaction-frame.tsx` - shared
   frame primitive and focus-target class.
2. `apps/web/src/components/home/WatchHomeCard.tsx` and
   `WatchHomeTvCarousel.tsx` - Watch home thumbnail families.
3. `apps/web/src/components/search/VideoCard.tsx` - search result thumbnails.
4. `apps/web/src/components/sections/MediaCollection.tsx` - Experience media
   thumbnails.
5. `apps/web/src/components/sections/CarouselVideo.tsx` - video carousel
   selector thumbnails.
6. `apps/web/src/components/watch/SiblingCarousel.tsx`,
   `SeriesEpisodeCard.tsx`, and `WatchHistoryClient.tsx` - Watch video,
   episode, and history thumbnails.
7. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   - language inventory video thumbnails.

## Grep These

- `VideoThumbnailInteractionFrame`
- `VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS`
- `watch-home-gradient-outline`
- `search-card-red-outline`
- `focus-visible:ring-amber`

## What To Build

1. Add one shared interaction-frame primitive with an inset 4px solid-white
   border, inherited corner radius, and matching hover/focus visibility.
2. Migrate every interactive production video-thumbnail family to that shared
   primitive and suppress its native or colored focus outline/ring.
3. Keep interaction frames above thumbnail copy, bevel, progress, and preview
   layers while preserving active-card indicators and pending states.
4. Remove obsolete Watch home red-gradient frame CSS and lock the remaining red
   search category treatment to category tiles rather than video cards.
5. Add shared and consumer contract tests that reject red, gradient, amber, and
   duplicate native focus treatments on video thumbnails.

## Constraints

- Static posters, embedded players, modal previews, Bible quote imagery,
  search category tiles, and section-navigation cards are not interactive video
  thumbnails and remain unchanged.
- Do not change routing, media data, Mux preview loading, card content, text
  scrims, backdrop behavior, or active/pending selection semantics.
- Keep the shared primitive CSS-only: no effects, state, requests, or runtime
  listeners.

## Verification

- Run the focused shared-frame and migrated consumer tests.
- Run Web typecheck, scoped lint, formatting, and `git diff --check`.
- Browser smoke Watch home, search, Experience, series episodes, chapter cards,
  history, and language inventory with pointer and keyboard interaction.
- Confirm the shared CSS-only primitive adds no requests, effects, client
  initialization, or page-load work.

## Completion Evidence

- Added the shared CSS-only `VideoThumbnailInteractionFrame` and migrated every
  production video-thumbnail family identified by repository search, including
  `CarouselVideo`; unroutable fallbacks render no interaction frame, hover
  response, or play affordance.
- Focused Vitest coverage passes: 11 files and 111 tests, including direct
  contracts for generated sections, language inventory, history, active and
  pending states, keyboard activation, and fallback behavior.
- Web typecheck, scoped ESLint, Prettier, and staged diff checks pass. Repository
  search finds no legacy Watch gradient class, red search-card frame, or
  red/amber thumbnail outline treatment.
- The local `/watch` route responds successfully. The shared frame adds no
  effects, listeners, requests, media work, or client state; it is one inert
  `pointer-events-none` span rendered only for interactive cards.
- Structured correctness, testing, maintainability, standards, performance,
  contract, adversarial, agent-native, and learnings reviews have no remaining
  actionable findings. A final real-browser hover/Tab sweep remains recommended
  before merge for visual stacking confirmation.
