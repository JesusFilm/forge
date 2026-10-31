---
title: "A load-gated media player must separate passive start from viewer intent"
date: "2026-10-20"
category: best-practices
module: apps/web
problem_type: best_practice
component: frontend_stimulus
severity: medium
symptoms:
  - "Deferring an autoplay intro until window load also delays a viewer's explicit Play by seconds"
  - "A viewer-paused hero starts playing again after a scroll or modal hold releases it"
  - "A muted subtitle track stops appearing after the media mount was deferred"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - WatchHomeTvCarousel
  - useWatchHomeHeroScrollPause
  - usePauseForWatchModal
  - HeroPlayer
tags:
  - media
  - performance
  - reduced-motion
  - user-intent
  - hls
  - watch-home
---

## Problem

PR #2840 mounts the Watch home intro `<mux-video>` after window `load`. In
a 1.6 Mbps fixture, this brought `load` about 240 ms and LCP about 250 ms
sooner, and was neutral on broadband. Three intent bugs came with the
gate, or with the hero pause work in #2829 that it builds on:

1. **Explicit Play waited for `load`.** With one slow below-fold image, a
   reduced-motion viewer's Play started about 8 s late.
2. **Sibling holds ignored the viewer's pause.** The scroll-pause and
   modal-pause hooks resume "what they paused". So a hero the viewer had
   paused restarted after a scroll round trip.
3. **Effects keyed on slide identity missed the late mount.** The
   subtitle effect ran before the player existed.

## Rules

- **Gate only the passive path.** Play, unmute or any explicit control
  sets a `viewerRequestedMedia` latch and mounts at once. Pause before
  `load` does not mount. Result: playing at 2.6 s instead of about 8 s in
  the held-image test, with the passive win unchanged.
- **Enforce a viewer hold at the media `play` event,** not only in the
  hook's own play calls. Any external resume path (scroll, modal, future
  hooks) is then re-paused while the hold is on. The toggle's own Play
  clears the hold first.
- **Pass the mount state into dependent effects** (`mediaMounted` in the
  dependencies). Anything that assumed "the video exists" moves when the
  mount moves.
- **Test each half separately.** Add one test per intent path and falsify
  each by reverting only that half. Lab-check that the first media request
  starts after `loadEventEnd` on the passive path.

## Limits

These are lab results in Chromium, from a fixture with the real carousel
and public Mux streams. They are not the real home page or field data.
Safari plays HLS natively and ignores the hls.js config.

## References

- PRs #2829 (feat-762) and #2840 (feat-773).
- `docs/reports/2026-10-20-watch-overnight-audit.md`.
