---
id: "feat-698"
title: "Watch chapter thumbnail progress indicator"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-14"
duration: 1
depends_on: []
blocks: []
tags: [web, watch, ui]
---

## Problem

Playback progress on Watch chapter thumbnails is a thick, glowing bar on a dark
track. It competes with the chapter title. Use a slimmer resume line closer to
the one viewers recognize from YouTube.

## Entry Point

- `apps/web/src/components/watch/SiblingCarousel.tsx` — the chapter card's
  `<WatchProgressBar className=...>` override
- `apps/web/src/components/watch/WatchProgressBar.tsx` (shared API; do not alter
  other surfaces)

## Grep These

- `WatchProgressBar` — five card surfaces share it; only the chapter carousel
  overrides it
- `data-testid="watch-progress-bar"`

## What To Build

- Keep the chapter card's playback progress and red fill.
- Make the chapter indicator 2px tall on a light translucent track
  (`bg-white/35`), with no glow on the track or the fill.
- Keep the shared default's 8px inset from the sides and bottom and its rounded
  ends. The owner tuned this by eye on 2026-10-14: a flush, square-ended strip
  read as too small and clipped by the card's rounded corners.
- Scope the treatment to chapter thumbnails; other progress bars remain
  unchanged.

## Constraints

- Do not change `WatchProgressBar`'s base classes; search, series episode, home
  and collection cards keep the existing bar.

## Verification

- Render the Watch chapter carousel with seeded progress
  (`localStorage["forge.watch_progress.v1.anonymous"]`) and capture a browser
  screenshot.
- Measure the first chapter bar: height 2px, 8px gap on the left, right and
  bottom of its card.
- Confirm cards without progress omit the indicator.
