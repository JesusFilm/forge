---
title: "fix: Watch no post-route black bridge"
type: "fix"
status: "complete"
date: "2026-06-13"
roadmap: "docs/roadmap/platform/feat-188-watch-no-post-route-black-bridge.md"
origin: "user production validation"
---

# fix: Watch no post-route black bridge

## Summary

Remove the destination-route black bridge that runs after a Watch chapter
click has already revealed the clicked cover.

## Problem Frame

The current sequenced transition does the first part correctly: the old hero
fades to black, the clicked chapter title/poster becomes visible behind black,
and the clicked cover reveals before route push. The destination bridge then
adds another black overlay after the new route commits. That makes the landed
page look like it is dimming from black again, which is the wrong final step.

## Requirements

- R1. Keep ordinary chapter clicks on the existing `covering` then `revealing`
  sequence before `router.push`.
- R2. Do not write or consume a session-storage poster bridge for the
  destination route.
- R3. Do not pass a forced route poster bridge key into `HeroPlayer`.
- R4. Pending optimistic covers still bridge through black while navigation is
  in flight.
- R5. Committed route-owned posters render directly without another
  `hero-player-cover-black-bridge`.
- R6. Modified clicks, route hrefs, playback data, downloads, subtitles, and
  share data remain unchanged.

## Implementation Units

### U1. Remove Destination Bridge State

- **Files:** `apps/web/src/components/watch/chapter-navigation.ts`,
  `apps/web/src/components/watch/WatchPageClient.tsx`.
- **Approach:** Delete the session-storage bridge helpers, remove the route
  bridge state, and push the route after the reveal delay without writing an
  extra intent.
- **Tests:** Update `WatchPageClient.navigation.test.tsx` to keep the delayed
  push assertions and remove the expected route bridge key.

### U2. Remove Forced Hero Bridge

- **Files:** `apps/web/src/components/watch/WatchSectionRenderer.tsx`,
  `apps/web/src/components/watch/HeroPlayer.tsx`.
- **Approach:** Stop threading `routePosterBridgeKey` and remove
  `forcePosterBridgeKey`. Make `HeroPlayer` render the black poster bridge only
  for pending optimistic loading covers, not committed route poster changes.
- **Tests:** Update `HeroPlayer.test.tsx` so committed route poster replacement
  does not render `hero-player-cover-black-bridge`.

### U3. Update Durable Guidance

- **Files:** `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`,
  `docs/roadmap/platform/feat-188-watch-no-post-route-black-bridge.md`.
- **Approach:** Document that destination route black bridges create the double
  transition and should not be used for this flow.

## Verification Commands

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on a local Watch route: click a chapter card and confirm the
  landed route does not dim from black again after the clicked cover reveal.
