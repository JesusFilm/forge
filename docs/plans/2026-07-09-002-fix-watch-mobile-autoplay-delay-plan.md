---
title: "fix: Watch Mobile Hero Autoplay Delay"
type: "fix"
status: "completed"
date: "2026-07-09"
---

# fix: Watch Mobile Hero Autoplay Delay

## Summary

Reduce the delay before the Watch hero muted preview starts on mobile without
returning to critical-path video downloads. The first render remains
poster-first, while visible mobile heroes can activate the Mux backend shortly
after the initial paint instead of waiting for `window.load` plus the current
8s idle fallback.

---

## Problem Frame

The current mobile delay is an intentional consequence of the completed
poster-first idle autoplay work. `HeroPlayer` renders the Mux poster first,
then schedules muted preview activation after `window.load`, an 8 second
timeout, and `requestIdleCallback`. That protects mobile cold-path
performance, but it makes the visible hero feel inert on real phones when the
user expects the muted preview to start quickly.

The fix should tune the activation scheduler, not undo the poster-first model.
Normal page loads must still avoid starting Mux segment downloads during the
initial render, and explicit user intent must remain immediate.

---

## Requirements

- R1. Normal Watch page loads keep the initial server/client render poster-only
  and do not mount `MuxVideo` before the first client effect.
- R2. Visible mobile heroes start the muted preview as soon as practical after
  first paint using a short, bounded delay rather than waiting for the current
  load-plus-8s idle path.
- R3. Desktop and offscreen/hidden-document cases keep a conservative idle
  activation path so page performance outside the visible mobile hero is not
  broadened.
- R4. `?autoplay=1`, saved-progress resume, and "Watch now" / "Tap to Unmute"
  continue to activate immediately through the existing intent-safe paths.
- R5. The scheduler must remain cancellable across unmounts, visibility
  changes, resize, and scroll so stale callbacks cannot mount media after the
  hero becomes ineligible.
- R6. Existing Mux metadata, HLS config, subtitles, loading indicator, mobile
  portrait frame transition, and scroll-pause behavior remain unchanged after
  activation.

---

## Acceptance Examples

- AE1. Given a normal mobile portrait Watch load with the hero in view, when
  React commits the poster-first shell, then no Mux backend is mounted during
  render and a short mobile activation timer is scheduled.
- AE2. Given that mobile activation timer fires while the document is visible
  and the hero is near the viewport, then `playerActivated` becomes true and
  the muted Mux preview mounts.
- AE3. Given the document is hidden or the hero is away from the viewport when
  the mobile timer fires, then activation is deferred until visibility or
  viewport eligibility returns.
- AE4. Given a desktop viewport, when the hero first renders, then activation
  still follows the existing conservative idle path rather than the fast mobile
  path.
- AE5. Given the user clicks "Watch now" before any scheduled activation, then
  the player mounts immediately and the click path still calls `play()` within
  the user gesture.

---

## Key Technical Decisions

- KTD1. Preserve poster-first rendering. This keeps the prior mobile LCP and
  payload protection while allowing the preview to start sooner after paint.
- KTD2. Split activation by viewport posture. A visible mobile hero is the only
  case where fast muted preview startup is product-visible enough to justify
  earlier media work; desktop and non-visible cases stay idle-gated.
- KTD3. Use a bounded timer before idle on mobile. `requestIdleCallback` can be
  too late or absent on mobile browsers; a short timer after commit gives the
  browser a paint opportunity without an 8s perceived delay.
- KTD4. Keep user intent above scheduler policy. Existing click, pointer-down,
  saved-progress, and `?autoplay=1` flows are already optimized for immediacy
  and should not be reworked in this slice.

---

## Implementation Units

### U1. Roadmap Tracking

- **Goal:** Create a follow-up roadmap item for this completed-feature
  regression/tuning slice before changing code.
- **Requirements:** R1-R6.
- **Dependencies:** None.
- **Files:** `docs/roadmap/platform/feat-244-watch-mobile-autoplay-delay.md`,
  `docs/roadmap/README.md`.
- **Approach:** Add the next sequential platform roadmap ticket with status
  `in-progress`, pointing to this plan, `HeroPlayer`, and its focused test
  suite. Keep the completed `feat-176` ticket intact as historical context.
- **Test scenarios:** Test expectation: none -- roadmap metadata only.
- **Verification:** The roadmap ticket exists, is in progress, and references
  the current plan and validation scope.

### U2. Mobile-Aware Preview Scheduler

- **Goal:** Replace the single 8s idle activation path with a scheduler that
  starts visible mobile previews quickly after first paint while retaining the
  conservative path elsewhere.
- **Requirements:** R1, R2, R3, R5, R6; AE1-AE4.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Introduce small scheduler helpers/constants near the existing
  idle preview constants. Detect mobile-like viewports with a conservative
  client-side media query or viewport-width check, schedule a short mobile
  timer after commit, and keep the existing visibility/near-viewport gate
  before calling `setPlayerActivated(true)`. Preserve the current load/idle
  behavior for desktop and retry on visibility, scroll, and resize.
- **Patterns to follow:** Current `isHeroNearViewport` eligibility, cancellable
  `clearScheduledWork`, and existing `installIdleCallbackStub` test helper.
- **Test scenarios:** Mobile visible hero schedules the fast timer and mounts
  Mux after it fires; hidden document blocks fast activation and retries after
  visibility returns; offscreen mobile hero blocks fast activation and retries
  after scroll; desktop viewport still uses the conservative idle path; unmount
  clears pending work without mounting Mux.
- **Verification:** Focused HeroPlayer tests prove the scheduler split and no
  regressions to poster-first initial render.

### U3. Intent Path Regression Coverage

- **Goal:** Ensure the earlier mobile scheduler does not slow or break existing
  explicit activation flows.
- **Requirements:** R4, R6; AE5.
- **Dependencies:** U2.
- **Files:** `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Reuse existing click-before-idle and `?autoplay=1` tests,
  updating timer expectations where needed. Add coverage only where the new
  scheduler could otherwise mask a bug in pointer-down or queued intent.
- **Patterns to follow:** Existing `handleWatchNowPointerDown`,
  `activatePlayerForIntent`, and autoplay query tests in the same suite.
- **Test scenarios:** Click before mobile timer fires mounts Mux and queues or
  runs sound intent as before; `?autoplay=1` mounts immediately without waiting
  for mobile or idle timers; saved progress still reveals chrome immediately.
- **Verification:** Focused tests pass without weakening existing autoplay,
  pointer, or resume assertions.

### U4. Validation and Learning Capture

- **Goal:** Validate the change and record the reason for the tuned scheduler
  so future performance work understands the trade-off.
- **Requirements:** R1-R6.
- **Dependencies:** U2, U3.
- **Files:** `docs/solutions/performance-issues/watch-mobile-autoplay-delay-20260709.md`,
  `docs/roadmap/platform/feat-244-watch-mobile-autoplay-delay.md`.
- **Approach:** Run focused unit coverage plus app-level type/lint checks.
  Smoke a mobile-sized Watch page and capture evidence that the poster appears
  immediately and the muted preview mounts quickly after load without
  requiring a user click.
- **Test scenarios:** Test expectation: none -- this unit records validation
  and completion evidence.
- **Verification:** The solution note names the old delay cause, the new
  scheduler behavior, and the validation evidence. The roadmap ticket is
  marked complete after implementation.

---

## Scope Boundaries

- Keep the Watch page's poster-first initial render. This task does not return
  to mounting Mux during render.
- Keep public Watch URLs, language switching, chapter navigation, subtitles,
  fullscreen, Mux Data metadata, and HLS config unchanged.
- Defer tap-to-play-only product exploration; this fix tunes muted autoplay
  speed rather than removing muted autoplay.

---

## Risks and Dependencies

- Earlier mobile media startup can increase mobile network work versus the
  strict idle path. The mitigation is limiting the fast path to visible mobile
  heroes after first paint and leaving desktop/offscreen cases conservative.
- Mobile browsers differ in timer, visibility, and autoplay behavior. The
  scheduler must tolerate blocked autoplay and rely on the existing
  autoplay-blocked recovery path.

---

## Sources and Research

- `apps/web/src/components/watch/HeroPlayer.tsx` contains the current
  `IDLE_PREVIEW_FALLBACK_DELAY_MS = 8000`, `window.load`, and
  `requestIdleCallback` activation path.
- `docs/roadmap/platform/feat-176-watch-hero-poster-idle-autoplay.md` records
  why immediate Mux playback was removed from the cold path.
- `docs/solutions/performance-issues/watch-hero-poster-idle-autoplay-20260610.md`
  records the poster-first pattern and follow-up trade-off.
- `docs/roadmap/platform/feat-223-watch-mobile-hero-playback-transition.md`
  requires keeping the mobile portrait preview frame and poster-first model.
