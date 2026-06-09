---
id: "feat-169"
title: "Watch Hero Cinematic Frame"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "video"
---

## Problem

The watch-page hero player currently uses the same fixed black stage height before and after the viewer commits playback. After Play with Sound, the video is contained but the surrounding player area does not intentionally create a centered cinematic frame with breathing room around the preserved video aspect ratio.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` - watch hero player layout, reveal state, and backend rendering.
2. `apps/web/src/components/watch/HeroPlayerControls.tsx` - custom player chrome portaled to the hero overlay anchor.
3. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - regression coverage for hero layout and reveal behavior.
4. `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md` - sticky hero and custom chrome layout guidance.

## Grep These

- `data-chrome-revealed`
- `h-[calc(100svh-300px)]`
- `REVEALED_VIDEO_OBJECT_FIT_STYLE`
- `hero-player-wrapper`

## What To Build

1. Keep the muted preview behavior intact.
2. When the viewer commits playback, animate the black player parent into a cinematic frame.
3. Center the video horizontally and vertically inside that black parent.
4. Preserve the video aspect ratio and keep the entire video visible.
5. Add responsive frame padding when the viewport has room; fitting the video wins when space is tight.
6. Add focused regression coverage for the committed playback frame classes.

## Constraints

- Do not recreate the provided reference image as a modal or white page.
- Do not change Mux backend selection, Mux Data metadata, subtitles, language switching, fullscreen, or media data fetching.
- Do not change the preview overlay or Play with Sound user-activation sequence.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- Browser smoke the watch page hero before and after Play with Sound.
