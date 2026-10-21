---
id: "feat-737"
title: "Keep Watch buffering feedback visible after controls hide"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch-page"
  - "video"
  - "loading-state"
---

## Problem

B25 / N63b: committed playback can enter `waiting` or `stalled` after the
controls auto-hide. The existing `hero-chrome-loading` spinner then mounts
inside a control bar with `opacity-0`.

## Entry Points — Read These First

1. `apps/web/src/components/watch/HeroPlayerControls.tsx`: `chromeVisibility`,
   idle timers, `playbackLoading`, and the portaled chrome/backdrop.
2. `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`:
   visibility and keyboard-focus regression tests.
3. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`: committed
   buffering lifecycle through the existing Mux event handlers.
4. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.

## Grep These

- `hero-chrome-loading`
- `chromeOpacityClass`
- `handlePlaybackBuffering`
- `CHROME_IDLE_HIDE_DELAY_MS`

## What To Build

First reproduce normal playback, actual auto-hide, then waiting/stalled with
an invisible spinner. If confirmed, keep the existing spinner and its control
affordance visible while `playbackLoading` is true; restore ordinary visibility
after recovery. Cover idle, focus, touch, and paused interactions as applicable.

## Constraints

- No new indicator, state machine, ABR changes, hover/logo/CTA colors, fonts,
  layout, catalog edits, analytics changes, or generated GraphQL edits.
- Keep fast playback, media initialization, and existing event wiring intact.
- Parent owns independent review, publication, CI, and roadmap index upkeep.

## Verification

- Prove the regression against unchanged product code before fixing it.
- Run focused HeroPlayerControls and HeroPlayer tests, relevant consumer
  coverage, formatting, lint, and TypeScript checks.
- Capture browser-computed spinner ancestor visibility before/after at desktop
  and mobile sizes, including recovery and ordinary auto-hide.
- Measure page-load/resource impact; disclose fixture-only evidence and any
  full-app verification gap.

## Historical Fixture Evidence

These initial component-fixture results precede the compatible full-app build
and paired browser verification below.

- Baseline timer-driven tests reproduced invisible buffering feedback for both
  waiting and stalled; playing and paused controls also reproduced the failure.
- Display visibility now follows `playbackLoading` while preserving the idle
  state and timers. Recovery, focus, touch, and normal hiding remain covered.
- Focused HeroPlayer, HeroPlayerControls, SubtitleOverlay, and
  FloatingSearchProvider suites: 348 passed, one pre-existing todo. Web
  TypeScript, scoped ESLint, formatting, and locale drift checks passed.
- Chrome 154 at 1280×800 and 390×844 measured spinner effective ancestor
  opacity changing from 0 to 1 during buffering, then normal hiding on recovery.
- Component fixture JS decreased 29 bytes; CSS stayed identical. No layout
  shifts or long tasks occurred across mount, buffering, and recovery. Warm
  mobile load was 11.8 ms before and 12.8 ms after in one run each.
- Historical verification limit: browser/performance evidence used real controls
  with fixture media inputs. The full app returned HTTP 500 with reused Next 16.2.4
  dependencies (checkout requires ^16.3.8), a `node:child_process` webpack error,
  and missing runtime environment. Compatible full-app verification was still
  outstanding at that stage.

## Compatible Build, Browser, and Review Evidence

- On main `90908a4326901232ec0ff7569744a0e6b7e89e25`, the refreshed focused
  HeroPlayer, HeroPlayerControls, SubtitleOverlay, FloatingSearchProvider, and
  HLS-startup suites passed 360 tests with one pre-existing todo. TypeScript,
  scoped ESLint, formatting, and locale drift checks passed.
- The default Next 16.3.8 / React 19.2.4 production build passed with the existing
  internal QA environment. Candidate build `7CleSsSLpddT-3kK3bjv9` and a clean
  matching-main baseline used the same loopback API environment and port for
  paired browser verification. Application configuration and source stayed
  unchanged during runtime setup.
- Actual decoded, moving playback, seek/play/pause controls, keyboard focus,
  and sampled geometry passed at 1280×800 and 390×844 CSS viewports. A brief
  trusted startup waiting event showed the candidate spinner at effective
  opacity 1 with bright controls before playback recovered.
- An explicitly synthetic diagnostic paused the existing real video, dispatched
  waiting, waited 6.5 seconds (longer than the idle timeout), then dispatched
  stalled and recovery. Baseline spinner effective opacity was 0; candidate opacity was 1
  while loading and returned to ordinary hidden state after recovery. This
  proves event wiring and CSS visibility with paused media.
- Across 24 retained warm, fixed-order navigation samples, both builds initiated
  35 scripts by load. Encoded initial JavaScript was 898,466 bytes for baseline
  and 898,446 for candidate (20 fewer). Observed mobile HLS work began after
  document load on both builds.
- The final independent review found no actionable findings and judged the
  frozen main-909 visibility increment review-ready. The earlier approved
  interactive Team Claude review and no-change adjudication remain recorded.
  A future main refresh or source change requires renewed review of that state.

## Scope Completion and Nonblocking Residuals

The narrow N63b visibility correction is complete. It follows N63a startup
selection in PR #2757; no ABR, HLS, media initialization, hover, or color behavior
is changed here.

Sustained natural network starvation was not exercised. Warm, fixed-order,
cache-uncontrolled timings and partial initial-mount, LCP, CLS, and long-task
windows do not establish full Core Web Vitals or statistical page-load
non-regression. Initial MIME failures and unattributed HTTP 503 transients remain
in the browser record with unknown causes; there is no clean-console claim.
Physical mobile, external transport, production, and future-head acceptance are
not established. These residuals do not block the reviewed visibility-only scope.
