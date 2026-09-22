---
title: "feat: Consistent short-watch feedback across recommendation APIs"
type: feat
date: "2026-09-23"
status: completed
roadmap: feat-533
---

# Consistent short-watch feedback across recommendation APIs

## Problem

A viewer opened a homepage recommendation, watched approximately 20 seconds,
returned home, and reloaded. The same six recommendations remained. The user
wants short viewing to influence subsequent recommendations and explicitly
included both homepage and below-player delivery in the scope.
The user also explicitly requires viewing from every discovery source to affect
recommendations and user profiles, rather than limiting feedback to clicks from
recommendation card blocks.

Implementation and automated verification are complete. The execution defaults
below resolve the earlier scope questions without expanding into a client-side
refresh project. See the [verification record](../validation/feat-533-short-watch-feedback.md)
for results and the remaining post-deployment browser smoke.

## Confirmed scope

- Own the change in Admin's recommendation APIs and backend ranking policy.
- Make short-watch treatment consistent across source-free homepage delivery and
  video-seeded below-player delivery. Define the signal and its ranking effect
  once and apply it through both paths, including applicable fallback paths.
- Make playback feedback source-independent. Any video watched through supported
  product playback paths must contribute to recommendation and profile updates
  under the same evidence and weighting rules, whether reached through search,
  homepage or category browsing, direct navigation, a shared or acquisition link,
  editorial content, or a recommendation card.
- Equivalent viewing must have an equivalent effect on recommendation and profile
  inputs regardless of discovery source. Recommendation selection, impression,
  request, or card attribution must not be a prerequisite for recording or
  consuming playback feedback. Preserve discovery source as attribution.
- Account for brief actual viewing even when it does not qualify for the
  existing interest-learning threshold. The user's 20-second example must be
  covered by the agreed policy.
- Return the updated ordering or selection on subsequent API requests. Browser
  shuffling is not the mechanism for making the recommendations responsive.
- Consistency means the same short-watch policy for equivalent authorized
  evidence. The two surfaces can still return different videos because
  below-player recommendations also use the current video as context.
- Preserve current-video exclusion below the player, language and playback
  eligibility, canonical deduplication, profile authorization and reset behavior,
  and existing response-count and request-latency contracts.

## Agreed execution behavior

A brief intentional watch supplies a temporary "recently tried" signal. Prefer
eligible unseen alternatives, or lower the watched video's position when supply
is limited. Keep this distinct from completion, a durable interest, or an explicit
dislike. Keep ordering deterministic for otherwise unchanged inputs.

Source independence applies to both recent-view context and qualified profile
learning. Short exits do not establish a durable positive interest or dislike.

This API-only scope does not require an already-rendered row to change while
playback continues. Immediate in-place refresh would require a separate client
request trigger.

## Execution defaults

1. At least three seconds of accepted visible-playing intervals in a real
   playback episode marks its video recently tried. Union overlapping intervals;
   starts, seeks, clicks, passive previews and hidden time alone do not qualify.
   Normal automatic continuation uses the same actual-playback rule.
2. For 24 hours, fresh eligible candidates precede recently tried candidates,
   including fresh curated candidates ahead of recently tried profile candidates.
   Refill from recently tried candidates only when fresh supply is insufficient.
3. Preserve seven-day completed-view rules and existing selection/served context.
4. Preserve existing qualified-interest thresholds and integrity gates. Read
   accepted short-watch facts before asynchronous finalization, without using
   short-only evidence as a thematic interest or an explicit negative preference.

## Grounding and implementation entry points

The implementation baseline was local `origin/main` at `badb8cc2c`, not the older
checkout at this task's workspace root. This is code evidence, not a trace of the
reporting viewer's production session. The following describes the pre-change
entry points used for investigation.

- `apps/admin/src/services/recommendations/user-history.service.ts` currently
  admits qualified finalized outcomes into homepage watch history.
- `apps/admin/src/services/recommendations/recent-context.service.ts` already
  includes accepted source-neutral playback starts for below-player recency.
- `apps/admin/src/services/recommendations/user-delivery.service.ts` composes
  profile-first homepage results with curated fill and history preferences.
- `apps/admin/src/services/recommendations/delivery.service.ts` and `slate.ts`
  apply below-player recency, current-video exclusion, and bounded refill.
- `apps/admin/src/services/recommendations/episode.service.ts`,
  `playback.service.ts`, `playback-outcome-consumer.ts`, and
  `profiles/profile-projection.service.ts` provide the source-neutral playback
  and profile-feedback path. Audit its end-to-end use, including episodes without
  a recommendation request, selection, or impression; build on the existing
  capability rather than introducing a recommendation-only feedback path.
- `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
  supplies the playback facts. Verify that existing accepted evidence is timely
  enough for the agreed API behavior before proposing any client change.

## Verification scope

- Test equivalent accepted short-watch evidence through both APIs, including
  homepage-to-video and video-to-home journeys and different discovery sources.
- Prove equal recommendation-history and profile-input effects for equivalent
  direct, search, browse/editorial, share/acquisition, and recommendation-origin
  playback. Include playback with no recommendation request or selection and
  verify both collection and downstream consumption, not only an accepted HTTP
  response. Exercise short and qualified watches in each origin group.
- Cover below-threshold playback, longer and completed viewing, repeated requests,
  expiration, canonical duplicates, sufficient alternatives, and limited supply.
- Cover buffered or pending finalization so a refresh cannot require a durable
  interest publication merely to recognize a recently tried video.
- Retain source-specific relevance, current-video exclusion, authorization,
  profile reset, evidence validity, language, and playable-card checks.
- Use `user-delivery.service.test.ts`, `recent-context.db.test.ts`, and
  `slate.test.ts` under the same service directory as existing test entry points;
  add focused shared-policy and homepage-history database coverage as needed.
- Extend `playback-episode.db.test.ts` and
  `profiles/profile-projection.service.db.test.ts` in the recommendation service
  directory to verify source-independent feedback through profile publication.
- Measure bounded database query work and both delivery latencies. Verify in the
  browser that rendered order follows the API response after return or reload.

## Implementation units

1. Add one bounded, source-neutral SQL policy for recently tried videos, shared
   by homepage history and below-player context. Preserve authorization fences.
2. Apply fresh-first composition and reserve refill across both delivery paths,
   including semantic-only and curated fallback. Keep completion filtering and
   canonical identity matching intact.
3. Test 20-second source parity, three-second and 24-hour boundaries, overlap,
   pending finalization, reset/privacy, qualified profile learning and latency.
4. Review, record the learning with ce-compound, refresh the related
   recommendation learnings with ce-compound-refresh, and complete feat-533.
