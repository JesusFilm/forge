---
id: "feat-517"
title: "Mobile Recommended for You Home shelf"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-09-18"
duration: 5
depends_on:
  - "feat-516"
blocks: []
tags:
  - "mobile"
  - "recommendations"
  - "personalization"
---

## Problem

`feat-516` gives mobile the recommendations data layer and playback
attribution, but no surface renders a slate. Web shows a six-card "Recommended
for You" row below Browse by category, placed by the authored
`HomepageRecommendationsBlock`. Mobile's Home body renders the same Experience
through the legacy fragment, which drops that block silently.

## Entry Points — Read These First

1. `apps/mobile/src/hooks/useUserRecommendations.ts` — status, items, `recordRender`, `recordImpression`, `select`.
2. `apps/mobile/src/lib/recommendations/context.ts` — locale and audio language resolution.
3. `apps/mobile/src/lib/watchHome/experienceAdapter.ts` — where Experience blocks become shelves.
4. `apps/mobile/src/components/home/HomeShelf.tsx` and `HomeCard.tsx` — the shelf and card surfaces.
5. `apps/web/src/components/recommendations/WatchForYouRecommendations.tsx` — the Web row to mirror.
6. `packages/admin-graphql/src/fragments/blocks/homepage-recommendations.ts` — the block's fields.

## Grep These

- `HomepageRecommendationsBlock`
- `adminLegacyWatchExperienceFragment`
- `useEligibleRecommendationImpression`
- `viewabilityConfig|onViewableItemsChanged`

## What To Build

- First, a real-environment smoke of `feat-516`: bootstrap, `status`, one
  playback episode accepted by Admin, against a provisioned endpoint.
- Detect the block in the Home Experience and render a shelf at its authored
  position with the localized "Recommended for You" title, falling back to the
  block's `title`.
- Feed the shelf from `useUserRecommendations` with the resolved context;
  render `position` order; show nothing on `unavailable` or `disabled`.
- Record `render` on mount and `impression` after 50% visibility for one
  continuous second, through FlashList viewability.
- On tap, call `select` and open `/watch/<videoSlug>`; the recorder redeems
  the pending claim.
- Refresh on Home return and on profile change.

## Constraints

- The block's GraphQL type must stay out of the legacy fragment until the
  Admin rollback window closes; detect the block without naming the type or
  move to the canonical fragment deliberately.
- Never substitute a shorter slate or a different audio language.
- Verify in the simulator with screenshots and a load-time comparison.
- Wiring `select()` arms a known recorder gap (feat-516 round-2 review):
  `resolveClaim` in `src/lib/recommendations/playbackRecorder.ts` consumes
  the selection nonce before a rate-limited claim waits out the limiter's
  window, so a `dispose()` during that wait loses the slate attribution and
  the replacement recorder falls back to a `direct` context. Close it in this
  ticket: restore the nonce on the disposed-abandon path, or take it
  immediately before the network claim, and pin it in
  `playbackRecorder.test.ts`.

## Verification

- Jest: shelf renders only on `served`; evidence fires once per item per
  slate; selection stores the pending claim before navigation.
- Simulator: six cards in position order; a tap opens the video and the
  playback recorder claims with the selection nonce.
