---
id: "feat-615"
title: "TV fresh-launch logo animation and sound"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 1
depends_on: []
blocks: []
tags: [tv, tvos, android, startup]
---

## Problem

Show the supplied Watch intro once after a fresh app launch, without replaying it during navigation or overlapping video audio.

## Entry Points — Read These First

- `docs/plans/2026-10-07-tv-startup-logo-audio.md`
- `apps/tv/app/_layout.tsx`: providers and movie overlay.
- `apps/tv/app/index.tsx`: Home data loading and auto-start Showcase.
- `apps/tv/app/showcase.tsx`: direct Showcase entry.
- `apps/tv/src/components/watch/VideoBackdrop.tsx`: hero play gate.

## Grep These

`StartupIntroProvider|useStartupIntroActive|createStartupIntroSession|autoStartConsumed`

## What To Build

A process-local startup latch, root animated logo overlay and bundled audio using the existing Expo Video dependency. Start data loading immediately behind the overlay; release playback only after stopping intro audio. Skip with remote Select. Stop on completion, error, timeout or background.

## Constraints

No persistent first-install flag, new native dependencies, other app changes, player redesign or preference resets. TV power-off alone does not guarantee the OS terminated the app; a retained app process must not replay the intro. Confirm audio distribution rights before public release.

## Verification

TV tests, typecheck, lint and formatting; physical Office Apple TV fresh launch, Select skip and warm return, logo screenshot and timing evidence. Android shares implementation but needs separate runtime verification.

October 7: implementation and physical Apple TV installation verified; 157 suites / 2,079 tests passed. Fresh-launch logo/speaker audio, non-overlap with Showcase, Select skip and same-process warm return checked. Evidence and measured intro timings are in the linked plan. Android runtime verification remains open; no store upload or public release.

October 8: fixed the animation-to-held-logo flicker by pausing the mounted Expo Image instead of replacing it with the static PNG. Installed and checked a Release build on the Apple TV 4K simulator: no blank samples through the handoff, then populated Home. 162 suites / 2,107 tests, typecheck, lint and formatting passed. Evidence is in `docs/plans/2026-10-07-tv-animation-settings.md`; Android runtime verification remains open.

Scoped PR branch on current main: 147 suites / 1,986 tests and all static checks passed. A fresh Release 4K simulator capture confirms the stable logo hold. Background-before-hydration audio startup and loading accessibility were corrected during review. See the linked plan for scope and remaining release gates.
