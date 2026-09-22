---
id: "feat-534"
title: "Watch hero CTA href stops carrying live playback time"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-09-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "web"
  - "carousel"
  - "performance"
---

## Problem

Linear [FGE-139](https://linear.app/jesus-film-project/issue/FGE-139) (W-003,
Urgent) — from the 2026-09-13 `/watch` listing audit.

The Watch home hero CTA renders its destination with the live preview position
baked in: `href={appendAutoplaySignal(slide.href, playbackTimeSeconds)}`. The
hook refreshes `playbackTimeSeconds` once a second while the muted intro plays,
so the rendered `href` string changes once a second. `next/link` prefetches an
in-viewport link whenever its `href` changes, so an idle `/watch` tab issues one
uncacheable RSC round-trip per second to the Railway origin for as long as it is
open. The audit measured 33 fetches of `/watch/miraculous-catch-of-fish.html` in
35 s, each RSC payload 26,218 B (~26 KB/s per idle tab).

The second half of the ticket's Fix paragraph — throttling `setPlaybackTime` to
whole seconds so the ~4 Hz `timeupdate` stops re-rendering at 4 Hz — is already
landed on `main` and is out of scope here.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — `appendAutoplaySignal`
   and the `PrimaryAction` `<Link>`; this is the only rendered href that carries `t`.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` — where
   `playbackTimeSeconds` is derived (`playbackTime.slideId === activeSlide?.id`)
   and already floored to whole seconds.
3. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
   — the page-load evidence this change owes.

## Grep These

- `appendAutoplaySignal`
- `playbackTimeSeconds`
- `WATCH_HERO_PRIMARY_ACTION_CLASS`

## What To Build

Make the rendered `href` **stable** rather than merely unprefetched, so the
per-second RSC fetch is impossible by construction and not one `prefetch`
default away from returning:

- `PrimaryAction` renders `appendAutoplaySignal(slide.href)` — `autoplay=1`
  only, no `t`. The string now changes only when the carousel advances.
- The live position is mirrored into a ref by an effect and read at click time;
  a left, unmodified click `preventDefault()`s and `router.push()`es the same
  URL **with** `t`, so resume behaviour is unchanged.
- Modified clicks (meta/ctrl/shift/alt, non-primary button) fall through to the
  browser untouched: those never reach the client router, so rewriting the
  destination there would be silently ignored.

Deliberately NOT done here: `prefetch={false}` on this link. That posture
decision belongs to FGE-215 (W-025); this fix is shaped so it neither blocks nor
presumes it, and likewise leaves FGE-209 (W-024, `staleTimes`) and FGE-146
(W-008, hero CTA retargeting) free.

## Constraints

- Do not touch the `MuxVideo` import or mount — FGE-138 owns that region of the
  same file on an independent branch.
- Do not re-do the whole-second `setPlaybackTime` throttle; it is already landed.
- Preserve analytics and recommendation behaviour (`docs/analytics-and-recommendation-policy.md`).

## Verification

- `pnpm --filter @forge/web test` — a suite that pins the rendered href across a
  playback-time change (red before the fix), the `t=` on click, and the
  modified-click passthrough.
- A ~35 s idle browser session on `/watch` showing **zero** repeated `?_rsc=`
  fetches for the hero destination.
- Page-load performance evidence per the convention above.
