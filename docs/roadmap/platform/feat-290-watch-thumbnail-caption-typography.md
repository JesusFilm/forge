---
id: "feat-290"
title: "Watch Thumbnail Caption Typography"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
  - "design-system"
---

## Problem

Watch thumbnail captions repeat local title and eyebrow styles across home,
Experience, search, series, and carousel cards. The repeated styles have drifted
to different font weights and uneven side and bottom spacing; the large home and
Experience titles are especially heavy and sit farther from the bottom edge than
the side edge.

## Entry Points

1. `apps/web/src/components/ui/video-thumbnail-caption.tsx` - shared caption typography and spacing primitive.
2. `apps/web/src/components/home/WatchHomeCard.tsx`, `WatchHomeHero.tsx`, and `WatchHomeTvCarousel.tsx` - Watch home thumbnail families.
3. `apps/web/src/components/sections/MediaCollection.tsx`, `NavigationCarousel.tsx`, and `CarouselVideo.tsx` - authored Experience thumbnail families.
4. `apps/web/src/components/search/VideoCard.tsx` - search result thumbnails.
5. `apps/web/src/components/watch/SeriesEpisodeCard.tsx` and `SiblingCarousel.tsx` - episode and chapter thumbnails.

## What To Build

1. Add a shared thumbnail-caption primitive for caption inset, eyebrow text, and title text.
2. Use medium-weight thumbnail titles instead of local bold or semibold variants.
3. Match each caption's side and bottom inset, with a compact variant for smaller cards.
4. Migrate production Watch thumbnail overlays to the shared primitive while preserving semantic heading levels, gradients, truncation, and navigation behavior.
5. Add focused styling-contract tests and capture browser proof of the updated cards.

## Constraints

- Do not change card dimensions, image treatment, routing, hover previews, progress, or interaction frames.
- Keep hero display copy outside thumbnail rails unchanged.
- Preserve title clamping and existing responsive type scales.
- The shared primitive must remain CSS-only and add no client state or effects.

## Type Contracts

- `ThumbnailCaptionInset`: `"compact" | "default"`.
- `VideoThumbnailTitle` supports only `h2`, `h3`, or `span`, with two- or
  three-line clamps and named responsive size variants.
- `VideoThumbnailEyebrow` supports only `div`, `p`, or `span` and named size
  variants; `VideoThumbnailDescription` remains a semantic paragraph.

## Grep Checks

- `rg -n "font-(bold|semibold)" apps/web/src/components/{home,search,sections,watch}`
  identifies thumbnail title weights that still bypass the shared primitive.
- `rg -n "VideoThumbnail(Caption|Eyebrow|Title|Description)" apps/web/src/components`
  audits production adoption of the shared caption API.
- `rg -n "pb-(3|4|5).*px-(3|4)|px-(3|4).*pb-(3|4|5)" apps/web/src/components`
  locates remaining open-coded caption inset pairs for review.

## Verification

- `pnpm --filter @forge/web test -- src/components/ui/video-thumbnail-caption.test.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web exec eslint src/components/home/WatchHomeCard.tsx src/components/home/WatchHomeHero.tsx src/components/home/WatchHomeTvCarousel.tsx src/components/search/VideoCard.tsx src/components/sections/CarouselVideo.tsx src/components/sections/MediaCollection.tsx src/components/sections/NavigationCarousel.tsx src/components/ui/video-thumbnail-caption.test.tsx src/components/ui/video-thumbnail-caption.tsx src/components/watch/SeriesEpisodeCard.tsx src/components/watch/SiblingCarousel.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web exec prettier --check src/components/home/WatchHomeCard.tsx src/components/home/WatchHomeHero.tsx src/components/home/WatchHomeTvCarousel.tsx src/components/search/VideoCard.tsx src/components/sections/CarouselVideo.tsx src/components/sections/MediaCollection.tsx src/components/sections/NavigationCarousel.tsx src/components/ui/video-thumbnail-caption.test.tsx src/components/ui/video-thumbnail-caption.tsx src/components/watch/SeriesEpisodeCard.tsx src/components/watch/SiblingCarousel.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx ../../docs/roadmap/platform/feat-290-watch-thumbnail-caption-typography.md`
- `git diff --check`
- Browser screenshot plus computed styles showing medium-weight titles with
  equal side and bottom inset.

## Completion Evidence

- Added the CSS-only `VideoThumbnailCaption`, `VideoThumbnailEyebrow`,
  `VideoThumbnailTitle`, and `VideoThumbnailDescription` primitives and migrated
  the Watch home, TV rail, Experience, search, episode, chapter, and legacy
  carousel thumbnail families without changing their responsive type scales.
- Shared titles now render at weight 500. Default captions use 16px side and
  bottom insets; compact captions use matched 12px insets and matched 16px
  insets from the small breakpoint.
- Focused Vitest coverage passes: 8 files and 124 tests. Web typecheck, scoped
  ESLint, Prettier, and `git diff --check` also pass.
- Local browser proof rendered six representative cards and confirmed every
  title computed to `font-weight: 500`, `padding-left: 16px`, and
  `padding-bottom: 16px`, with no console errors. The normal data-backed Watch
  home could not render because the pre-existing local Admin process was
  disconnected from its Postgres host, so proof used a temporary local route
  with the production `WatchHomeCard`; that route was removed after capture.
- The simplification pass preserved responsive type scales, tightened the
  polymorphic element types, made eyebrow truncation effective, and avoided
  repeated Tailwind-merge work on static thumbnail rerenders.
