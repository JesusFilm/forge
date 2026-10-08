---
id: "feat-638"
title: "Preserve Watch home carousel fallback media tiers"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "carousel"
---

## Problem

Empty-but-present Admin image and HLS values suppress valid Mux fallback URLs in
the Watch home TV carousel. This can show the full hero poster in the small
video timeline and classify a playable video as a still image.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx`
2. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx`
3. `apps/web/src/components/home/useWatchHomeTvCarousel.ts`

## Grep These

- `watchHomeHeroSlidesToTvCarouselSlides`
- `thumbnailUrl`
- `src: slide.hls`
- `Boolean(slide.src)`

## What To Build

- Fall through blank authored thumbnails and HLS sources to their Mux tiers.
- Verify a blank HLS field with a valid playback ID remains a video slide and
  uses the small Mux thumbnail in the timeline.

## Verification

- Focused WatchHomePage tests.
- `pnpm --filter @forge/web typecheck`
- Scoped lint and formatting.
