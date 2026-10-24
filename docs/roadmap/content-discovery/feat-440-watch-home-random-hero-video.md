---
id: "feat-440"
title: "Watch home hero opens on a random library video"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-27"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "web"
  - "performance"
---

## Problem

The Watch homepage hero ran a fixed programme: every visitor opened on the same
branded Mux insert and the same date-seeded lineup, with a thumbnail rail of the
upcoming slides pinned directly beneath the player. Two consequences:

1. The homepage looked identical on every visit, so returning visitors saw the
   same opening video instead of being introduced to the breadth of the library.
2. The rail rendered one `next/image` per queued slide immediately below the
   fold-line, so the hero region shipped nine images and ~130 DOM nodes before
   the visitor had done anything.

The route is `force-static` with `revalidate = 3600`, so the opening video
cannot be drawn per request on the server without turning a Redis-cached HTML
read into a full RSC render of a very heavy page on every visit.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - hero player and
   overlay. The rail (`WatchHomeTvRail` / `WatchHomeTvCard`), the branded Mux
   insert action UI, and the "Watch Short Film" full-player takeover all lived
   here and are gone.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` - slide state,
   bootstrap index, the post-mount per-visit draw, play tracking.
3. `apps/web/src/lib/watch-home-carousel-sequence.ts` - pool queue construction,
   `pickRandomWatchHomeHeroVideo`, `boundedRandomIndex`.
4. `apps/web/src/lib/watch-home.ts` - `buildCarouselPools` builds the pools the
   draw runs over; they already ship in the RSC payload.

## Grep These

- `pickRandomWatchHomeHeroVideo`
- `isWatchHomeHeroPlayableAspect`
- `readWatchHomeVerticalVideoIds`
- `randomStartAppliedRef`
- `pendingRandomHeroIdRef`
- `watch-home-tv-rail`

## What Was Built

- `pickRandomWatchHomeHeroVideo({ pools, playedIds, random })` draws one playable
  video uniformly across every pool the server shipped, skipping ids this browser
  already played until the whole set has been seen.
- `buildWatchHomeVideoQueue` accepts an optional `randomSource`; supplying it
  swaps the date-seeded pool offset for a per-visit draw so the follow-on lineup
  differs too. Omitting it keeps the deterministic behaviour server render needs.
- The hook draws once in a mount effect and pins the result via `activeSlideId`.
  Server render and the first client render both use
  the deterministic `firstPlayableIndex`, so the static HTML is byte-identical
  visitor and hydration cannot mismatch.
- Play tracking is suppressed until the drawn hero commits, so the deterministic
  bootstrap slide is not permanently excluded from everyone's draw.
- The rail is removed.
- Branded Mux inserts are removed end to end: the insert config and its types,
  `mergeWatchHomeMuxInserts` and the mux slide kind, the insert action UI, the
  "Watch Short Film" full-player takeover (whose only entry point was an insert),
  and the `WatchHomeMuxInserts` i18n namespace across all 225 catalogs.
  `WatchHomeTvCarouselSlide` is now an alias of the video slide shape.
- Portrait sources are kept out of the hero. `isWatchHomeHeroPlayableAspect`
  rejects anything squarer than `WATCH_HOME_HERO_MIN_ASPECT_RATIO` (1.2), so
  16:9 and 4:3 pass while 1:1, 4:5 and 9:16 do not. The decision is made from
  the DECODED size at `loadedmetadata` — admin exposes no video dimensions, and
  image dimensions are a false proxy because landscape films routinely ship
  portrait posters. A measured-portrait video is recorded in
  `carousel-vertical-ids` (same monthly bucket as played ids, so a re-encode
  self-heals), skipped immediately, and hard-excluded from every later draw and
  queue build. Unknown or unmeasured sizes are always allowed through, and the
  skip is bounded by the slide count so an all-portrait pool cannot loop.
- The hero keeps a mount-time chrome reveal. Shell chrome visibility survives
  client-side navigation, so arriving from a watch page whose player hid the
  header still has to restore it.

## Constraints

- Do not decide orientation from `VideoImage` width/height/aspectRatio. That is
  the poster's shape, not the video's, and portrait posters on landscape films
  are common — it would drop good videos.
- Do not move the draw into render or into a server component. Render-time
  randomness breaks hydration and makes the route uncacheable; a server draw
  costs a full dynamic render of the whole homepage per request.
- Do not add a request for the draw. The pools are already in the payload.
- Keep the deterministic path (`randomSource` omitted) intact - it is what SSR
  and the first client render use.

## Verification

- `pnpm --filter @forge/web test` (3057 passing)
- Vertical guard proven in a real browser against a real 720x1280 HLS stream
  (ffmpeg `testsrc`, served from a local admin stub): three portrait videos were
  measured, recorded to `carousel-vertical-ids`, and skipped; the hero settled
  on 1920x1080 every time and never re-drew a recorded id across reloads.
- `pnpm --filter @forge/web typecheck`, `lint`, `build`
- Measured with a production-shaped fixture (4 pools x 5 videos + sequence-start
  insert), hero region at load: images 9 -> 1, DOM nodes 132 -> 47, SSR HTML
  38,164 B -> 21,213 B (gzip 6,093 -> 5,181).

## Not In Scope

`apps/mobile` keeps its own independent copy of the carousel sequence and Mux
insert config under `apps/mobile/src/lib/watchHome/`. Nothing in this ticket
touches it, and the mobile home carousel still plays branded inserts.

## Follow-ups

- `progress` from `useWatchHomeTvCarousel` is now write-only; the rail was its
  only consumer. Dropping it would remove a 250ms re-render interval during the
  poster hold.
- Browser-level LCP/Web Vitals evidence still owed; the local worktree has no
  reachable Admin GraphQL endpoint to render the homepage against.
