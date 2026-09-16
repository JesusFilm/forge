---
id: "feat-512"
title: "Learn sound-off viewing preferences and retrieve suitable videos"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-16"
duration: 5
depends_on:
  - "feat-378"
blocks: []
tags: [admin, web, recommendations, playback, profiles]
---

## Problem

Watch opens a muted preview before explicit activation. A viewer can deliberately
watch that preview without pressing Watch now. The owner requires sustained
visible sound-off viewing to shape the profile and augment retrieval with relevant
videos that work well WITHOUT sound. This is a proper behavior signal; muted
playback is not intrinsically weaker than sound-on playback. Autoplay alone,
off-screen playback and immediate departures are not evidence of preference.

## Entry Points — Read These First

1. `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
   and `apps/web/src/components/watch/HeroPlayer.tsx` — current preview/activation
   boundary, player state and elapsed-time collector.
2. `apps/admin/src/services/recommendations/contracts.ts` and
   `apps/web/src/lib/recommendation-contracts.ts` and the playback route — bounded fact schemas.
3. `apps/admin/src/services/recommendations/profiles/` — generation, retention,
   explicit disable/reset/delete and authoritative profile/session links.
4. `apps/admin/src/services/recommendations/candidates/profile-candidate.service.ts`,
   `delivery.service.ts` and `orchestration.ts` — bounded candidate retrieval,
   nomination provenance, relevance and final eligibility.
5. `docs/plans/2026-09-16-002-feat-recommendation-quality-followthrough-plan.md`.

## Grep These

`initiationRef|playback_active_visible_playing|volumechange|IntersectionObserver|privacy_generation|qualified_outcome|CandidateNomination`

## What To Build

- Record meaningful on-screen playing time with sound state and preview versus
  activated context. Track at least half-player visibility with a visible
  document; pause timing on off-screen, hidden, paused, stalled or bfcache states.
- Derive a separate sound-off preference from trustworthy retained behavior.
  Preserve missingness; no observer or missing telemetry cannot mean zero viewing.
- Augment retrieval/ranking with relevant videos supported by mode-specific
  visible engagement/completion, with minimum evidence, duration normalization,
  bounded repeat contributions and ordinary recommendations for sparse data.
- Keep the same episode through preview-to-activated playback and avoid duplicate
  topic/mode contributions. Bound looping previews rather than counting repeated
  cycles as independent viewers or completions.
- Expose mode preference and candidate reasons in authorized Admin diagnostics.
  Version the policy and record ownership, retention, access and rollback.

## Constraints

Keep preview first. Do not infer dislike from an exit, attention from visibility
alone, or audio suitability from popularity alone. Respect exact locale/audio,
publication/playability, recent history, profile generations and erasure. No
Recommendation Visibility (feat-373), locale expansion (feat-471), For you
activation, consent gate or model call on the request path.

## Verification

Test muted preview, explicit activation, mute/volume transitions, scrolling,
hidden tabs, stalls, loop replay, short media, telemetry failure, late/replayed
facts and reset/delete races. Verify sustained viewing changes mode preference
and eligible retrieval while brief/off-screen viewing does not. Exercise the
actual browser journey and compare page-loading cost, plus real PostgreSQL
profile/retrieval boundaries. Run affected app checks and Compound review.
