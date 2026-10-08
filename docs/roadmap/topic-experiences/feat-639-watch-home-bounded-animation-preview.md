---
id: "feat-639"
title: "Bound Watch Home Hero Media Before Playback Intent"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
  - "video"
---

## Problem

The Watch home hero starts HLS playback for a muted browsing preview. Even with
480p rendition selection and a bounded buffer, a viewer who does not interact
can continue downloading the full-length film while browsing the carousel.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - hero media,
   HLS source mounting, poster and preview rendering.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` - active slide,
   preview timer, and playback intent state.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` - integrated
   hero behavior and media-source assertions.
4. `apps/web/src/lib/url.ts` - Mux animated preview URL recipe.

## Grep These

- `hasPlaybackIntent`
- `resolveMuxAnimatedPreviewUrl`
- `watch-home-tv-video`
- `Unmute preview`
- `WATCH_HOME_TV_PREVIEW`

## What To Build

1. Use a bounded animated Mux preview while the viewer browses muted; use a
   448px/8fps preview on mobile and a 640px/6fps preview on wide screens. Do not
   mount or request HLS before explicit playback intent.
2. On the first unmute action, mount the existing quality-capped HLS stream.
   Later mute actions must change sound only and preserve the active stream.
3. Preserve carousel timing, focus, subtitles, slide changes, and fallbacks.
4. Add focused coverage proving HLS is absent before intent and remains mounted
   when the viewer mutes again after starting playback.

## Constraints

- Keep the existing HLS rendition and buffer limits after playback intent.
- Do not autoplay full-length media before a user action.
- Preserve the existing accessible mute/unmute labels and keyboard behavior.
- Do not change GraphQL contracts or generated artifacts.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/__tests__/WatchHomePage.test.tsx src/components/home/__tests__/useWatchHomeTvCarousel.test.ts src/components/home/__tests__/WatchHomeVideoSequence.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Scoped Prettier check and `git diff --check`.
- Review initial muted and post-intent playback behavior at a narrow viewport.
- Confirm the animated preview asset remains below the 2 MB transfer target.
