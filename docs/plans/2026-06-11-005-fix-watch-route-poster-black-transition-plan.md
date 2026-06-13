---
title: "fix: Watch route poster black transition"
type: "fix"
status: "completed"
date: "2026-06-11"
roadmap: "docs/roadmap/platform/feat-182-watch-route-poster-black-transition.md"
origin: "user production report"
---

# fix: Watch route poster black transition

## Summary

Tighten the Watch hero cover transition so the optimistic clicked poster and
the committed route poster share the same visual contract. Any visible poster
replacement after a chapter click should dim through black before the new cover
appears.

## Problem Frame

`feat-181` bridges pending optimistic posters through black. The production
report shows the route commit can still feel abrupt because the route-owned
poster replaces the optimistic clicked poster without the bridge once pending
state clears. The fix belongs in `HeroPlayer`, where the final visible poster
URL is already derived.

## Requirements

- R1. A pending optimistic chapter poster still fades in from black and pulses
  while the destination route is loading.
- R2. When the committed route poster URL replaces the optimistic clicked
  poster URL, the route poster also appears out of black.
- R3. Initial page load should not flash black just because the first poster is
  rendered.
- R4. Normal non-loading route posters should reveal without the loading pulse.
- R5. Activated player pre-`canplay` posters should keep the existing loading
  pulse behavior.
- R6. Playback, Mux metadata, subtitles, downloads, share payload, language
  options, and public Watch URLs remain route-owned and unchanged.
- R7. Reduced-motion users should not receive decorative bridge or pulse
  animations.

## Key Technical Decisions

- **KTD1. Track visible poster URL, not pending state only:** The player should
  decide whether to bridge from the final visible poster URL so the same rule
  covers pending clicks and route commits.
- **KTD2. Avoid black on first render:** Store the current poster URL in local
  render state and only enable the bridge after that URL changes.
- **KTD3. Split reveal from pulse:** A route commit needs black-to-cover reveal,
  but not an infinite loading pulse unless the player is actually loading.
- **KTD4. Persist only the destination bridge intent:** The optimistic chapter
  payload should still self-invalidate on route commit, so the route-boundary
  animation uses a tiny one-shot `sessionStorage` intent keyed by target video,
  language, and href.

## Implementation Units

### U1. Hero Poster Identity Transition

- **Goal:** Bridge every visible poster URL change through black.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/app/globals.css`.
- **Approach:** Derive a poster identity from `visualHeroPosterUrl`, track
  whether that identity has changed since mount, and use that transition state
  to render the black bridge. Let `WatchPageClient` pass a one-shot forced
  bridge key to destination route mounts after valid chapter clicks. Add a
  non-pulsing reveal class for committed route posters.
- **Test Scenarios:** Initial route poster has no bridge. Pending optimistic
  poster has bridge plus pulse. Route poster replacement after pending state
  clears has bridge plus non-pulsing reveal.

### U2. Focused Test Coverage

- **Goal:** Lock the reported production handoff.
- **Files:** `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Add a rerender test that starts with a pending optimistic
  clicked poster, then rerenders the same player with a committed route block
  whose poster URL differs. Assert the route poster layer reports
  `black-bridge` and the poster image uses the reveal class.
- **Test Scenarios:** The route commit bridge appears even though
  `optimisticVisual` is absent. The route commit does not mark the cover as a
  pending loading pulse.

### U3. Validation And Smoke

- **Goal:** Prove the fix in tests and a browser.
- **Files:** No production files beyond U1/U2.
- **Approach:** Run focused HeroPlayer tests, web typecheck, web lint, and a
  local browser smoke on a single-video Watch route with a chapter carousel.
- **Test Scenarios:** Click a carousel episode and confirm the route-owned
  poster layer reports `data-cover-transition="black-bridge"` after the route
  commits.

## Verification Commands

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium/browser smoke on a local single-video Watch route with chapter
  carousel.

## Completion Notes

- `HeroPlayer` now bridges visible poster URL changes and accepts a forced
  route bridge key for destination mounts that would otherwise start from a
  fresh component state.
- `WatchPageClient` writes a one-shot chapter poster bridge intent on normal
  carousel clicks and consumes it only when the destination video, language,
  and href match.
- Local browser smoke on
  `/watch/resurrected-jesus-appears.html/english.html` clicked
  `Great Commission and Ascension`; after route commit, the hero title was the
  clicked video and the route poster layer reported
  `data-cover-transition="black-bridge"` with `watch-hero-cover-reveal`.
