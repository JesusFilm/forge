---
id: "feat-915"
title: "Keep Watch Home Hero Stable During Interaction"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "accessibility"
  - "video"
---

## Problem

The Watch home hero can change slides while a viewer hovers over or tabs to its
primary Watch Now action. The title and destination can change while the viewer
is reading or preparing to activate the CTA.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — hero section,
   Watch Now action, and carousel state wiring.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` — advance clock,
   held-turn accounting, and ended-event handling.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — rendered
   slide advancement and focus behavior.

## Grep These

- `WatchHomeTvCarouselRegion`
- `PrimaryAction`
- `isTurnHeld`
- `advanceClockRef`
- `handleEnded`

## What To Build

- Hold the slide-advance clock while a mouse pointer is inside the hero.
- Hold the slide-advance clock while keyboard-visible focus is inside the hero;
  resume only after focus leaves the region.
- Preserve remaining time when the interaction hold ends.
- Keep media playback available during a hover/focus hold.

## Constraints

- Do not change carousel ordering, preview duration, or route handling.
- Do not pause or mute playback solely because of hover or focus.
- Do not add dependencies or network requests.

## Verification

- Under fake timers, assert hover and focus each stop timed slide advancement and
  leaving the region resumes the remaining time.
- Run focused Watch homepage tests, Web typecheck, scoped ESLint/Prettier, and
  `git diff --check`.

## Implementation Progress

- The hero region holds the advance clock while hovered by a mouse or while
  keyboard-visible focus remains inside it. Touch pointers do not create a
  hover hold, and pointer focus does not create a keyboard hold.
- Pointer and focus holds are tracked independently so leaving with the mouse
  does not clear a keyboard focus hold.
- The hold uses the existing turn-clock pause path, which preserves elapsed
  time and does not pause the media. If video ends during the hold, its slide
  advance is deferred until the interaction ends.
- If a focused CTA is removed by a slide update, a post-commit containment
  check clears the keyboard hold when focus is no longer within the hero.
- October 8 incoming validation reported 77 homepage tests, including mouse hover, keyboard
  focus, touch entry, remaining-time resume, deferred video-end, and orphaned
  focus recovery checks. That historical result is superseded by the candidate
  validation below.

## October 30 Integration and Review

- FGE-146 / W-008 comes from the collective September 13 automated Watch audit;
  the named original human reporter is unknown. R3-2627-1 is a separate P2 from
  coordinator source review, not a new finding attributed to that reporter.
- Integrate incoming `6a22c1b2a0c2591f2a2679fec79dbd9b9682438d` with canonical
  main `067a1c27b53590db9d384b608e0a352b7847e090`. Main's player files are the
  conflict base; preserve their playback, modal, autoplay refusal, poster,
  deferred-play, turn-token, subtitle, and prefetch behavior.
- The old owned feat-632 collides with PR2638's deterministic-poster ticket.
  A fresh fully paginated all-author audit of 167 open PRs, 4,534 unique commit
  heads from local refs/worktrees, local roadmap files/indexes, and coordinator
  reservations found 914 as the highest occupied ID. Reserve feat-915 locally
  before renaming only this ticket and its owned README reference.
- The buffering watchdog must check and depend on
  `pauseAdvanceForInteraction`. A held stalled stream keeps its film; release
  starts a fresh 12-second recovery window. Normal dwell and natural ended use
  their existing held-clock and deferred-end paths.
- Watchdog regressions mount the actual carousel and the exact offered hook:
  mouse/keyboard × waiting/never-canplay all fail on the offered source by
  changing title, href and source. The repaired hook must pass four separately
  committed 10-second waits and recover only after release.
- Keep decoded portrait rejection as main's bounded orientation-recovery policy,
  including during an interaction hold. This is distinct from normal timed
  advancement; do not claim every automatic selection path is held. Missing or
  invalid duration keeps main's finite backstop fallback.
- Same-film CTA removal must also rerun focused-element containment cleanup;
  observing only slide id can leave an orphaned keyboard hold. Test authored
  fallback props changing href to null without changing film id.

## Composition Limits and Acceptance

This candidate contains current main plus this owned interaction delta. It does
not import the separately unmerged contracts of PR2383 (`ec76b919` stable raw
href/live activation), PR2840 (`953126a7` page-load/media attachment/watchdog
modal gates), PR2829 (`11ddfb70` persistent pause/reduced motion), or PR2853
(`dcec964e` initial-poster fade removal). Their shared component/hook/test seams
require exact-tree composition and regression checks when the parent lands them.

Main's running-media `t=` query changes are retained: this ticket holds film and
slide identity. Waiting, image and held-ended cases assert complete href/title
stability. A separate running-media regression pins stable film/path identity
while its live time query changes. Do not call this a passing PR2383 contract.

Parent acceptance on the published candidate:

1. With mouse hover or keyboard-visible focus on Watch Now, hold a
   never-canplay/waiting stream for more than 36 seconds. Verify film, title and
   complete href stay fixed; release and verify recovery after 12 seconds.
2. Let media end under combined mouse/focus ownership. Release either owner,
   verify no change, then release the final owner and verify one advance.
3. Hold an image after two seconds of its seven-second dwell; release and verify
   the five seconds remaining. Check touch, pointer-owned focus, removed CTA,
   deliberate timeline selection, and the documented portrait recovery exception.
4. Verify current-main modal/playback, subtitles and prefetch behavior, and record
   real browser/device/loading acceptance on the exact resulting composition.

Source/component tests and a serialized React fixture do not establish real HLS,
keyboard-modality, device, page-load, target-environment or production acceptance.
Independent parent review and candidate CI remain required; Linear status is
owned by the parent.

## Durable Learning

Every normal automatic advancement owner must honor interaction, including
recovery watchdogs that bypass the regular turn clock. Keep media playback and
film-retargeting ownership separate. Tests must span multiple watchdog periods,
commit timer intervals separately, and compare complete destinations when media
is stationary. Source correctness, shared-file integration, loading measurements,
and environment acceptance require separate evidence.

## Candidate Validation

- Implementation complete in the uncommitted current-main integration candidate.
  154 focused tests pass: 115 homepage, 20 hook/helper, 5 hero prefetch, and 14
  modal-provider tests, with at most two workers. The same-film cleanup regression
  also fails when its href dependency is removed. Earlier fixture failures and
  the four offered-hook watchdog failures are preserved as evidence.
- Main and candidate serialize byte-identical deterministic React fixture HTML
  (39,321 bytes) with identical declared media/image resources. This uses test
  doubles and measures no HTTP requests, real player startup, LCP or hydration
  timing. Source checks retain main's media, subtitle, playback and prefetch
  owners unchanged; the added work is interaction state/ref updates and existing
  timer cancellation/rearming.
- Parent independent review, published-candidate CI and actual browser/device/load
  acceptance remain open. Completing this repository implementation ticket does
  not resolve FGE-146, approve the PR or certify the four separate compositions.
