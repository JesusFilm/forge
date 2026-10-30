---
id: "feat-911"
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

- `prefetch={false}` on that same link. Historical stable-href-only measurement
  recorded 8 fetches of the hero destination in 48 seconds, with unequal
  baseline and category-control windows. It does not establish a Next.js
  refresh mechanism or current performance. Keep the explicit hero opt-out
  and verify its network effect with matched production-build controls.
  Scope is this one link, so FGE-215 (W-025, the same posture for
  category tiles), FGE-209 (W-024, bounding the fan-out) and FGE-146 (W-008,
  hero CTA retargeting) are all left free.

## Accepted tradeoffs

- **Modified clicks lose the resume deep link.** Before this change the rendered
  href carried `t=`, so cmd/ctrl/middle-clicking "Watch Now" opened a new tab at
  the viewer's exact preview position. It now opens at `t=0` with autoplay. This
  is the direct, unavoidable cost of a href React can keep still, and it is the
  behaviour the "leaves a modified click to the browser" test pins. Accepted
  deliberately; recorded here so it is not later mistaken for a regression.
- **The hero CTA now fetches its RSC payload at click time.** `prefetch={false}`
  trades a warm click for the idle-tab cost. Measured at 609 ms click-to-commit
  on a local production build. FGE-215 (W-025) already wants this posture for
  touch; FGE-209 (W-024) is the ticket that could restore a bounded warm path.

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

## Verification status

Still `in-progress`: local integration and unit validation do not establish runtime acceptance.

- **Test gap closed.** The mocked-`next/link` primaryAction suite now asserts
  that the successful resume click's `event.defaultPrevented` is `true`. Before,
  the suite asserted only the push count, which does not show that the handler's
  `preventDefault` ran. With only `event.preventDefault()` removed from
  `PrimaryAction`, that one test fails (`expected false to be true`) and the
  other nine pass; with the line restored, both affected home suites pass 80/80.
- **Scope of the claim.** This pins the handler's cancellation only. It does not
  show what the real `next/link` or App Router does with a cancelled event, and
  no native or browser dispatch was observed. `WatchHomePage.test.tsx` no longer
  says its push count proves that.
- **Local integration:** main at `067a1c27b53590db9d384b608e0a352b7847e090`
  is composed with the stable autoplay-only href and committed-position resume
  click. The same-second render-throttle check retains main's fake-timer/frame
  stabilization and exact next-second render count, with resume URL assertions.
  Hero prefetch stays explicitly off through touch/mouse pointer intent and
  keyboard focus; the category rail's intent gate remains unchanged. The three
  affected hero/home/category-prefetch suites pass 117 tests locally; adding
  the unchanged category and VideoCard controls yields 221 passing tests on
  pinned Node 24.22.1. These are mocked handler/prop tests,
  not measurements of real Next routing or production network traffic.
- **Build limit:** production webpack compilation and generated-route TypeScript
  checking pass with two workers. Page-data collection stops because this
  checkout has no `ADMIN_GRAPHQL_URL`, `WEB_ADMIN_API_KEYS` or
  `REVALIDATION_SECRET`. No provider or backend flags were disabled to pass.
  The non-generating Web typecheck, scoped lint, format, locale drift and
  hidden-roadmap-lane checks pass. Full runtime and load-performance acceptance
  remain open.
- **Ticket identity:** this ticket was renumbered from feat-534 after auditing
  current main, all-author open PR heads and frontmatter, local refs, worktree
  tickets and reservations. Main's independent Studio and membership tickets
  keep their identities.
- **Still open:** exact integrated-head CI, a healthy real-Admin build, runtime and
  device checks (including the idle-tab prefetch window and click-to-commit),
  and page-load performance evidence. The original reporter is unknown, and the
  W003 canvas row is not mapped.
- **Recovery preflight, 2026-10-30:** the coordinator recovered this candidate
  after the worker's provider turn failed. A read-only GraphQL preflight using
  the existing local consumer credential returned HTTP 403 from the public
  Admin endpoint. That endpoint cannot currently supply healthy real-content
  acceptance; no auth, backend or telemetry flag was disabled to bypass it.
