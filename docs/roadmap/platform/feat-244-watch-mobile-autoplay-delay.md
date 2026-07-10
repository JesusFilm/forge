---
id: "feat-244"
title: "Watch mobile hero autoplay delay"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on:
  - "feat-176"
  - "feat-223"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mobile"
  - "performance"
---

## Problem

The Watch hero video does not feel like it autoplays instantly on mobile. The
delay is caused by the completed poster-first idle autoplay work: normal page
loads render the Mux poster first, then wait for `window.load`, an 8 second
delay, and `requestIdleCallback` before mounting the muted Mux preview.

That protects mobile cold-path performance, but it is too slow for a visible
mobile hero. The follow-up should start the muted preview sooner after first
paint without returning Mux video downloads to the initial render.

## Entry Points

1. `docs/plans/2026-07-09-002-fix-watch-mobile-autoplay-delay-plan.md`
2. `apps/web/src/components/watch/HeroPlayer.tsx`
3. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
4. `docs/solutions/performance-issues/watch-hero-poster-idle-autoplay-20260610.md`
5. `docs/roadmap/platform/feat-223-watch-mobile-hero-playback-transition.md`

## What To Build

1. Keep the initial Watch hero render poster-only.
2. Add a faster activation path for visible mobile heroes shortly after first
   paint.
3. Keep desktop, hidden-document, and offscreen hero activation conservative.
4. Preserve `?autoplay=1`, saved-progress resume, and explicit "Watch now"
   activation behavior.
5. Keep Mux metadata, HLS config, subtitles, loading indicator, and mobile
   portrait frame behavior unchanged after activation.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Mobile browser smoke on a Watch page confirms the poster appears immediately
  and the muted preview mounts quickly after first paint.
