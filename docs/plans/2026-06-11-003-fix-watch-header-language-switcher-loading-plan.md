---
title: "fix: Watch Header Language Switcher During Loading"
type: "fix"
status: "completed"
date: "2026-06-11"
roadmap: "docs/roadmap/platform/feat-179-watch-header-language-switcher-loading.md"
origin: "user bug report: globe language switch disappears after episode carousel click during muted preview"
---

# fix: Watch Header Language Switcher During Loading

## Summary

Keep the floating header language globe visible during watch-to-watch client
loading transitions, while preserving loaded-page authority for whether the
current hero actually supports language switching.

## Problem Frame

`FloatingSearchProvider` owns the global header and resets its language switcher
state on pathname changes. `HeroPlayer` publishes the language switcher callback
while mounted, then publishes `visible:false` during cleanup. When a user clicks
an episode carousel item during muted preview, the old hero cleanup and provider
pathname reset run before the next watch page has loaded, so the globe
disappears during the loading stage.

## Requirements

- R1. On watch video and episode routes, an unmount cleanup from the previous
  hero must not clear the last valid language switcher during route loading.
- R2. A mounted/loaded hero state remains authoritative; if it reports no
  language switcher, the header must hide the globe.
- R3. Leaving watch video/episode routes still clears the stale switcher.
- R4. The event contract remains client-safe and does not load staged modal
  code early.

## Key Technical Decisions

- **KTD1. Distinguish cleanup from state.** Add a narrow optional reason to
  the language-switcher event detail so cleanup events can be treated
  differently from loaded hero state.
- **KTD2. Retain only on watch media routes.** The provider may ignore cleanup
  clears only when the browser remains on a watch video or episode pathname;
  non-watch routes clear immediately.
- **KTD3. Let loaded false win.** A `reason:"state"` event with
  `visible:false` clears the button, preventing stale controls on single-
  language or fullscreen loaded pages.

## Implementation Units

### U1. Language Switcher Event Contract

- **Goal:** Let the provider tell unmount cleanup apart from authoritative
  mounted state.
- **Requirements:** R1, R2, R4.
- **Files:** `apps/web/src/lib/watch-player-chrome-events.ts`,
  `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Add an optional `reason` field to
  `WatchHeaderLanguageSwitcherDetail`. Publish `reason:"state"` from the main
  hero effect body and `reason:"cleanup"` from the effect cleanup.
- **Test scenarios:**
  - Hero emits visible state updates with `reason:"state"`.
  - Hero cleanup emits `visible:false` with `reason:"cleanup"`.
- **Verification:** Focused HeroPlayer tests cover the emitted details.

### U2. Floating Header Retention

- **Goal:** Preserve the previous language button through watch media loading
  transitions without leaking it to non-watch pages.
- **Requirements:** R1, R2, R3.
- **Files:** `apps/web/src/components/FloatingSearchProvider.tsx`,
  `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Approach:** Add a small pathname classifier that strips the `/watch`
  basePath and recognizes canonical video/episode routes. On cleanup-only
  hide events, retain the current switcher when the current browser pathname is
  still a watch media route. On pathname changes, clear only when the new path
  is not a watch media route.
- **Test scenarios:**
  - A cleanup hide event on `/watch/death-of-jesus.html/english.html` keeps
    the existing button clickable.
  - A loaded state hide event on that route removes the button.
  - Navigating to `/watch/videos` clears the stale button.
- **Verification:** Focused provider tests cover retention and clearing.

## Scope Boundaries

- Do not change language picker modal loading, language option fetching, or
  language-switch URL construction.
- Do not change player playback state, muted preview activation, or carousel
  routing.
- Do not alter global search behavior.

## Risks and Dependencies

- **Pathname shape:** `usePathname()` may include Next's `/watch` basePath in
  the browser, while internal route helpers operate on basePath-stripped
  paths. The classifier should handle both.
- **Stale callback:** Retaining a callback during loading is intentional; the
  next mounted hero replaces it. Loaded false states must still clear it.

## Documentation and Operational Notes

- Mark `docs/roadmap/platform/feat-179-watch-header-language-switcher-loading.md`
  complete after code review and browser proof.
- This is a follow-up to `feat-178` staged client loading and should remain a
  small regression fix.

## Sources and Research

- `docs/roadmap/platform/feat-178-watch-staged-client-loading.md`
- `docs/plans/2026-06-11-002-perf-watch-staged-client-loading-plan.md`
- `apps/web/CLAUDE.md`
