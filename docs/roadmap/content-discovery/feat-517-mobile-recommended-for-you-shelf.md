---
id: "feat-517"
title: "Mobile Recommended for You Home shelf"
owner: "urim"
priority: "P2"
status: "in-progress"
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

## Results — 2026-09-21

Implementation units U1 to U5 of the plan
(`docs/plans/2026-09-21-1009-feat-mobile-recommended-for-you-shelf-plan.md`)
are built, tested and committed on `worktree-feat-517-mobile-recommended-shelf`.
The full mobile jest suite (278 suites, 4,512 tests), `tsc --noEmit` and
`eslint .` pass.

### Behavior smoke against the fake-admin proxy — 2026-09-21

iPhone 16 Pro simulator, a fresh install of the dev client built the same day,
the worktree's own Metro, and the throwaway proxy from
`docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`
extended to serve six real production videos as a slate, answer the evidence
and selection mutations, and inject the block into the forwarded homepage
Experience. Every line below is from the proxy's request log.

- Bootstrap: one `CreateRecommendationViewer`, then one `UserRecommendations`
  for `en` / `english`, count 6, then six `render` facts once each, all
  within 80 ms of the delivery.
- Six landscape cards rendered under the app's own "Recommended for You"
  title at the block's position (first shelf, because the proxy placed the
  block after the client-owned hero block).
- Impressions: exactly one per card as each pair scrolled into view (items 1
  and 2, then 3 and 4, then 5 and 6), about 1.2 s after each settle; a swipe
  back over recorded cards recorded nothing more; the partially visible third
  card recorded nothing.
- Tap: `SelectSemanticRecommendation` for the tapped item, then
  `ClaimSemanticRecommendationEpisode` with the selection nonce
  (`viaSelection: true`, media id matches), then `playback_attempt` and
  `playback_start`; no `IssueWatchPlaybackContext` on that open. The watch
  page painted the poster and the title from the seed.
- Return from the watch route: one refetch, six `render` facts under the new
  request id, impressions re-armed for the visible cards.
- Tab switch (Search and back): no delivery and no evidence.
- Pull-to-refresh: the homepage Experience request and the slate request
  fired within 30 ms of each other; the row stayed in the feed.
- Expiry on screen: the slate refetched at its `expiresAt` (150 s in the
  proxy) while Home was focused.
- Expiry while blurred: on the Search tab past `expiresAt`, no delivery and
  no evidence for 56 s; on return to Home exactly one refetch, and none in the
  following 12 s.
- Double-tap on one card: one selection, one claim, one watch screen (one
  back tap returned to Home).

### Production already carries the block (2026-09-23)

- The plan and PR #2367 both assumed the shelf would ship dark, because
  production's `watch-home` Experience carried no `HomepageRecommendationsBlock`.
  **That is no longer true.** Verified 2026-09-23 by querying production through
  the smoke proxy with injection OFF: the Experience returns 14 blocks and
  `HomepageRecommendationsBlock` sits at index 2. It arrived with the web
  recommendation pilot activation that merged to `main` while this sat in draft.
- Block presence is this shelf's ONLY gate (KD1), so the row goes live for every
  installation as soon as the code reaches phones. There is no editor-gated
  window in front of the release.
- NOT established: whether Admin serves a slate to a mobile installation or
  refuses it as outside the web pilot. Answering it means requesting a real slate
  from production as a fresh anonymous viewer, which creates production
  identities, and KD4 forbids that. Left open rather than probed.
- The open decision is whether block presence alone remains the right gate.
  `EXPO_PUBLIC_RECOMMENDATIONS_ENABLED=false` is the client lever and was
  measured working on device the same day (zero slate requests with the block
  present). Unpublishing the block is NOT a mobile mitigation, because the web
  surface is using it.

### R20 load timing — MEASURED (2026-09-23)

Measured inside the app from `HomeScreen` mount to first content render, so
app-startup spread sits outside the window. iPhone 17 Pro, merged head, six
samples per arm.

| Arm                                           |   n | median | min | max |
| --------------------------------------------- | --: | -----: | --: | --: |
| Shelf active, slate deliberately held 2000 ms |   6 |  96 ms |  88 | 142 |
| Recommendations disabled, zero slate requests |   6 |  96 ms |  88 | 170 |

Identical medians while the slate is two seconds late in one arm and never
requested in the other: the first paint does not wait on the slate. The proxy
gained a slate-only delay knob for this, because an instant slate makes R20
unfalsifiable — and a provisioned local Admin answering over loopback would have
had the same blind spot, so U6 would NOT have produced better evidence here.

A genuine block-absent arm is unobtainable now that production carries the block;
the proxy can only add one. The disabled arm is the control instead. A first pass
was discarded after another agent drove the same simulator: half the launches
never reached the test proxy and the shelf-absent arm measured the wrong
configuration. The re-run used a dedicated simulator and validated every arm
against the proxy's own record.

### Still open

- The `feat-516` double-recorder fix (KD3) merged on 2026-09-22 as #2376, so
  that blocker on U6 is closed. Its learning merged as #2390.
- U6, the real-environment smoke against a provisioned local Admin (R19), is
  DEFERRED by decision on 2026-09-23, and PR #2367 shipped without it. The
  gap it leaves is that no run has proved a real Admin records exactly one
  attributed episode for a shelf tap. The proxy smoke proves what the app
  sends, never what Admin stores.
- A POST-MERGE attribution smoke did run on 2026-09-23 against the fake-admin
  proxy, on the merged head, and covers the app's half of that gap. Cold launch
  served one slate (`deliveries=1`, `served=6`), six `render` facts once each,
  `impression` only for the two on-screen cards. One tap gave ONE
  `SelectSemanticRecommendation` and ONE `ClaimSemanticRecommendationEpisode`
  (`viaSelection=true`, `selectedMediaMatches=true`, `nonceMatches=true`).
  Minimise to the floating player then expand — the remount that used to start
  a second recorder — added no recorder: playback continued on the same media
  with no restart, and the return to Home refetched once (`deliveries=2`).
  Totals for the run: 1 selection, 1 claim, 1 `playback_attempt`, 1
  `playback_start`.
- U6 still needs a provisioned local Admin. Re-checked on 2026-09-23: the
  database sits at 17 of 100 migrations, and the restore needs a PostgreSQL 18
  client AND server while the machine runs 17, whose one cluster also holds 12
  databases owned by other projects. Production writes its dumps with 18, and
  `pg_restore` refuses an archive newer than itself, so 18 is a floor rather
  than a preference. The restore also requires its target schema to be current
  first, so those migrations are a precondition, not optional preparation.
- Three prerequisites previously recorded as blockers are NOT blockers.
  `RECOMMENDATION_CAPABILITY_KEYRING` and `FLEET_ADMIN_API_KEYS` are both
  optional in the Admin env schema and generatable locally, because the same
  local Admin signs and verifies them. The backup download credential is
  already set, and pgvector already ships a PostgreSQL 18 build.
- U7's timing comparison (R20) needs U6's block-present configuration and is
  deferred with it; the conventions section in `apps/mobile/CLAUDE.md` is
  written.
- The native build before the next `eas update` is unchanged from `feat-516`.
