---
title: "fix: Move Share action to Watch video hero"
type: fix
status: active
date: 2026-07-14
---

# fix: Move Share action to Watch video hero

## Summary

Move the Share affordance from the Watch home carousel to the pre-play action
row of individual Watch video pages. The action remains a localized text
button and opens the existing lazy Share modal.

---

## Problem Frame

The prior home-hero implementation does not match the intended placement.
Viewers need Share beside the individual page's Watch Now action, without a
second share flow or a change to the canonical video URL contract.

---

## Requirements

- R1. Individual video-page heroes render a localized text Share action beside
  the pre-play Watch Now action when the player has not revealed its chrome.
- R2. Selecting Share calls the page-owned Share callback and opens the
  existing lazy Share modal for the current video and public audio language.
- R3. The Watch home carousel does not render or manage a video Share action.
- R4. Revealing player chrome removes Share with the pre-play Watch Now action.
- R5. Share continues to use the existing standalone canonical video URL;
  contextual Watch routes remain navigation-only.

---

## Key Technical Decisions

- Reuse `WatchPageClient`'s `openShare` callback: it already lazy-loads the
  modal and coordinates player pause and resume state.
- Thread an optional callback through `WatchSectionRenderer` into
  `HeroPlayer`: this keeps hero UI client-local without introducing a new modal
  owner or an href-based sharing path.
- Reuse the existing `BibleQuotes.share` localization: every catalog already
  supplies this copy, avoiding a broad catalog migration.
- Remove the home-carousel integration completely: the user selected
  individual pages as the only supported surface.

---

## Implementation Units

### U1. Remove the Watch home Share integration

- **Goal:** Return the home carousel to its prior Watch Now-only behavior.
- **Requirements:** R3.
- **Dependencies:** None.
- **Files:** `apps/web/src/components/home/WatchHomeTvCarousel.tsx`, `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx`, `apps/web/src/components/home/useWatchHomeTvCarousel.ts`, `apps/web/src/components/home/__tests__/useWatchHomeTvCarousel.test.ts`, `apps/web/src/lib/watch-home.ts`, `apps/web/src/lib/watch-home-carousel-sequence.ts`, `apps/web/src/lib/watch-language-home-sections.ts`, `apps/web/src/lib/__tests__/watch-home.test.ts`, `apps/web/src/lib/__tests__/watch-language-home-sections.test.ts`, `apps/web/src/lib/watch-home-carousel-sequence.test.ts`.
- **Approach:** Delete the home-only Share state, modal import, action control,
  pause logic, share identity fields, and their behavioral tests end-to-end.
- **Patterns to follow:** Keep Mux promotional CTA behavior and carousel timing
  unchanged.
- **Test scenarios:** Home catalog and promotional slides render their existing
  actions without a home Share trigger; share identity is absent from home
  models and carousel types; carousel play and navigation behavior remains
  unchanged.
- **Verification:** Home-focused tests pass without a Share modal mounted from
  the carousel.

### U2. Add Share to the individual video hero action row

- **Goal:** Pair a secondary Share text button with the video hero's Watch Now
  control before chrome is revealed.
- **Requirements:** R1, R2, R4, R5.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`, `apps/web/src/components/watch/WatchSectionRenderer.tsx`, `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`, `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx`, `apps/web/src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`.
- **Approach:** Forward the existing page-owned Share callback to `HeroPlayer`.
  Render an aligned, wrapping action row in the pre-play overlay with Watch Now
  as the primary control and localized Share as the text secondary; keep it out
  of player chrome and invoke the callback without navigation.
- **Patterns to follow:** `onLanguageClick` callback forwarding in
  `WatchSectionRenderer` and the existing pre-reveal overlay lifecycle in
  `HeroPlayer`.
- **Test scenarios:** The pre-play overlay presents one text-style Share button
  beside Watch Now at desktop and narrow widths; clicking, Enter, and Space
  invoke the forwarded callback once without activating playback; the action is
  absent after Watch Now reveals chrome; a renderer receives
  `modalCallbacks.openShare` and passes it to the hero; a contextual video
  route opens the existing modal with the standalone canonical video target,
  then restores focus and the prior playback state on close.
- **Verification:** Hero and renderer unit tests pass, and a browser smoke on a
  standalone video route shows Share beside Watch Now and opens the existing
  modal.

---

## Scope Boundaries

- Out of scope: new share providers, Share modal copy or design changes,
  canonical/SEO updates, contextual-route changes, and a Share action on the
  Watch home carousel.

---

## Sources & Research

- `apps/web/src/components/watch/WatchPageClient.tsx` owns the current lazy
  modal state and player pause/resume behavior.
- `apps/web/src/components/watch/HeroPlayer.tsx` owns the individual page's
  pre-play action row.
- `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md`
  defines the standalone public video URL contract used by sharing.
