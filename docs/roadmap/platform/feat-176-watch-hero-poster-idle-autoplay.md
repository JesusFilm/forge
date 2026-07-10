---
id: "feat-176"
title: "Watch hero poster-first idle autoplay"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
duration: 1
depends_on:
  - "feat-175"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
---

## Problem

Live Lighthouse evidence after feat-175 shows that server-rendered metadata,
the LCP preload, and ISR cache HIT behavior are working, but mobile cold-path
performance is still dominated by the hero player starting real Mux playback
during initial load. The first audit downloaded multiple Mux video chunks
before user intent, inflating total payload, main-thread work, and Total
Blocking Time. A comparison audit that blocked only Mux video segment traffic
cut payload from about 6.3 MiB to about 1.4 MiB and reduced TBT from about
890 ms to about 245 ms.

## Entry Points - Read These First

1. `docs/plans/2026-06-10-004-fix-watch-hero-poster-idle-autoplay-plan.md` -
   implementation plan for the poster-first idle autoplay slice.
2. `apps/web/src/components/watch/HeroPlayer.tsx` - hero player activation,
   poster URL, Mux backend branches, and pre-reveal playback state.
3. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - existing
   MuxPlayer/MuxVideo prop, autoplay, ready-state, and interaction coverage.
4. `docs/solutions/performance-issues/watch-cold-path-performance-follow-up-20260610.md`
   - post-deploy evidence that motivates this follow-up.
5. `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
   - prior Watch hero LCP and Mux playback tuning playbook.

## Grep These

- `autoPlay="muted"`
- `preload="metadata"`
- `heroPosterUrl`
- `videoReady`
- `handleUnmuteClick`
- `autoplayParam`
- `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO`

## What To Build

1. Render a normal poster image immediately in the hero using the existing
   Mux poster URL that matches the route-level preload.
2. Do not mount `MuxPlayer` or `MuxVideo` on the initial render unless
   `?autoplay=1` is present.
3. After `window.load`, schedule muted preview activation with
   `requestIdleCallback`, falling back to a short timeout when the browser
   does not support it.
4. Only run idle activation when the document is visible and the hero remains
   in or near the viewport.
5. Preserve immediate user intent: clicking "Play with Sound" mounts the
   player immediately and continues the existing unmuted playback flow.
6. Keep both Mux backends covered; the existing
   `NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` flag still selects the activated
   backend.

## Constraints

- Do not change canonical URL ownership or public `/watch` URL shape.
- Do not remove the MuxPlayer fallback branch in this slice.
- Do not drop Mux Data metadata, `player_name`, or the MuxVideo
  `disableTracking={false}` override.
- Do not start video segment downloads on the initial render for normal page
  loads.
- Preserve `?autoplay=1` behavior used by language switching and deliberate
  deep-link playback.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium smoke on a watch route confirms poster-first render, delayed muted
  preview, and click-to-play behavior.
- Lighthouse or network evidence confirms no Mux video segment requests are
  made before the delayed activation point on a normal initial page load.

## Completion Evidence

- Focused HeroPlayer suite passed: 68 passed, 2 todo.
- `@forge/web` typecheck, lint, and production build passed.
- Server HTML for the local watch route contains the standalone
  `hero-player-poster` image and no rendered Mux backend element on initial
  HTML.
- Helium opened the local watch route, captured the desktop hero smoke, found
  one H1 and no page errors. Immediate browser state had zero Mux backend
  elements and no Mux stream requests; after `1800ms`, one Mux backend mounted
  and the Mux stream manifest request started.

## Plan

Implementation plan:
`docs/plans/2026-06-10-004-fix-watch-hero-poster-idle-autoplay-plan.md`
