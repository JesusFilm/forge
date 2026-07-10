---
title: "fix: Watch chapter cover loading transition"
type: "fix"
status: "completed"
date: "2026-06-11"
roadmap: "docs/roadmap/platform/feat-181-watch-chapter-cover-loading-transition.md"
origin: "user request"
---

# fix: Watch chapter cover loading transition

## Summary

Extend the existing chapter-click optimistic Watch shell so the hero cover does
not snap directly from the current video to the clicked episode. A pending
chapter click should keep the title/body title instant, then bridge the cover
through black, fade the clicked cover in, and pulse the cover while the video
route or player is loading.

## Problem Frame

`feat-180` completed the data flow from `SiblingCarousel` to
`WatchPageClient`, `WatchSectionRenderer`, `HeroPlayer`, and `WatchBody`.
That makes the clicked episode's title and poster appear immediately while the
Next route resolves. The remaining UX issue is motion quality: the cover swap
is abrupt, and the hero cover does not visually communicate that the clicked
episode is still loading.

## Requirements

- R1. A normal chapter-card click still updates the visible hero title and body
  title immediately from the pending chapter payload.
- R2. The hero cover for a pending chapter click transitions to black first,
  then fades from black into the clicked cover image.
- R3. The hero cover pulses subtly while a pending chapter route is loading.
- R4. The hero cover also pulses while an activated player is mounted but has
  not fired `canplay`.
- R5. The optimistic visual shell must not change the actual playback source,
  Mux metadata, subtitles, downloads, share payload, or language options until
  the destination route commits.
- R6. Reduced-motion users should not receive the decorative black bridge or
  pulse animation.

## Key Technical Decisions

- **KTD1. Keep pending semantics in the existing chapter visual contract:**
  Add loading and transition-key metadata to `WatchChapterOptimisticVisual` so
  `HeroPlayer` can distinguish a route-pending optimistic cover from ordinary
  route posters.
- **KTD2. Use CSS keyframes rather than timers:** Key the poster bridge by the
  target video id and let CSS restart the black-to-cover transition on each
  new pending chapter. This avoids effect cleanup and keeps React state out of
  a purely visual transition.
- **KTD3. Pulse only the visible cover layer:** The pulse belongs to the poster
  image wrapper, not the player, controls, title, or carousel. It should run
  during pending route load or pre-`canplay` player load, then disappear once
  the route commits or media is ready.
- **KTD4. Leave playback route-owned:** The clicked chapter has enough data for
  title and poster only. The current route continues to own playback until
  Next renders the destination page.

## Implementation Units

### U1. Pending Visual Contract

- **Goal:** Mark pending chapter hero visuals as loading transitions.
- **Files:** `apps/web/src/components/watch/chapter-navigation.ts`,
  `apps/web/src/components/watch/WatchSectionRenderer.tsx`,
  `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx`.
- **Approach:** Add optional `loading` and `transitionKey` fields to
  `WatchChapterOptimisticVisual`. When `pendingChapter` exists,
  `WatchSectionRenderer` sets `loading: true` and uses
  `pendingChapter.targetVideoDocumentId` as the transition key.
- **Test Scenarios:** Pending projection includes the clicked title, label,
  poster, loading flag, and transition key. Non-pending renders continue to
  pass no optimistic visual.

### U2. Hero Cover Transition And Pulse

- **Goal:** Render the black bridge, fade-in cover, and loading pulse on the
  hero poster layer.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/app/globals.css`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Derive `coverLoading` from pending optimistic visuals or
  `playerActivated && !videoReady`. Key the poster wrapper by
  `transitionKey`, add a black bridge element only for pending optimistic
  covers, and add CSS animation hooks for black bridge, cover reveal, and
  subtle cover pulse. Guard animations with `prefers-reduced-motion`.
- **Test Scenarios:** A pending optimistic visual renders a black bridge
  element, marks the poster wrapper as loading/transitioning, and applies the
  pulse class to the cover. A normal optimistic visual keeps the current
  opacity behavior without the black bridge. Activated pre-`canplay` posters
  mark the cover as loading.

### U3. Validation And Smoke

- **Goal:** Prove the change is type-safe, focused-test safe, and visible in a
  browser.
- **Files:** No production files beyond U1/U2.
- **Approach:** Run focused HeroPlayer/WatchSectionRenderer tests, the web
  typecheck and lint, then launch `@forge/web` and use Helium/browser smoke on
  a watch route with a chapter carousel.
- **Test Scenarios:** Before click: normal route poster. Immediate after click:
  title updates, cover passes through black, and target cover pulses while
  pending. Settled route: destination title/poster are route-owned and the
  pending pulse is gone.

## Verification Commands

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchSectionRenderer.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Helium/browser smoke on a local single-video Watch route with chapter
  carousel.
