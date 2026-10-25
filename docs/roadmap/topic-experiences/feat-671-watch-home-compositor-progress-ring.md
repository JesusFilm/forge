---
id: "feat-671"
title: "Watch Home compositor progress ring"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

Chrome reports the Watch Home hero progress animations (`watch-home-progress-ring`
and `watch-home-progress-ring-reset`) as non-composited because they animate
`stroke-dashoffset` (`compositeFailed` with `unsupportedProperties:
["stroke-dashoffset"]`, reproduced on the pre-change CSS). Non-composited
animations repaint on the main thread. FGE-221 attributed a throttled mobile
shift cluster (score 0.0187) to them; that causal link is **not established** —
a `stroke-dashoffset` animation paints, it does not move layout — so this
ticket claims only the compositor/paint improvement, not a CLS change.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — progress and reset
   ring markup and pause/buffering behavior.
2. `apps/web/src/app/globals.css` — ring keyframes and reduced-motion styles.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — carousel
   progress behavior tests.
4. `apps/web/src/app/globals.test.ts` — CSS contract for the ring motion.
5. `apps/mobile/src/components/bible/ReaderProgressRing.tsx` — the same
   two-half clipped-rotation fill, already used in the mobile app.

## Grep These

- `watch-home-progress-ring`
- `watch-home-progress-ring-second`
- `watch-home-progress-ring-reset`
- `stroke-dashoffset`

## What To Build

The ring stays a progress **fill**: the lit arc is the elapsed share of the
slide. It is two half-ring arcs with fixed dash geometry (half the
circumference), each in its own static half-ring viewport. The first rotates
`-180deg → 0` over the first half of the slide, the second `0 → 180deg` after
a half-duration delay, so the visible fill grows 0 → 100% using `transform`
only. Butt caps keep a parked arc from drawing a dot at 0%. Pause and buffering
hold both halves; the buffering dim sits on the group. The reset cue fades the
full ring with `opacity` only. At rest and under reduced motion both arcs sit
outside their clips, giving the empty ring the old dash geometry gave.

A single constant-length arc rotating once per slide was rejected: it turns on
the compositor but cannot show how much is left (its length never changes, it
reads 24% lit at 0% and at 100%, and it looks like the buffering spinner).

## Constraints

- Do not animate `stroke-dashoffset` or other layout/paint-only properties.
- Do not change slide selection timing or buffering semantics.
- Do not reduce the progress ring to a decorative spinner.

## Verification

- `pnpm --filter @forge/web exec vitest run src/app/globals.test.ts src/components/home/__tests__/WatchHomePage.test.tsx`
  — fixed half-circumference dash geometry, both halves held on pause/stall,
  transform-only/opacity-only keyframes, half-duration delay, reduced motion.
- Headless Chromium (harness mirroring the component markup and the real CSS
  rules, not the full page): the pre-change CSS reports `compositeFailed`
  for `stroke-dashoffset` on both the progress and reset animations; the new
  CSS reports none; the lit fraction at 0/10/25/50/75/90/100% of the duration
  is 0/0.10/0.25/0.50/0.75/0.90/1.0, contiguous from 12 o'clock.
- No page-load or Web Vitals claim is made; no before/after CLS data exists.
