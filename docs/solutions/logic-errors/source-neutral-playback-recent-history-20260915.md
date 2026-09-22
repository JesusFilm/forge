---
title: "Share short-watch feedback through source-neutral playback evidence"
date: "2026-09-15"
last_updated: "2026-09-23"
category: "logic-errors"
module: "Admin recommendation history and profile feedback"
problem_type: "logic_error"
component: "service_object"
symptoms:
  - "Profile candidates can repeat directly watched videos without recency suppression"
  - "Accepted buffered starts disappear when client timestamps precede episode issuance"
  - "A 20-second watch leaves homepage recommendations unchanged after reload"
  - "Recommendation-origin qualified playback requires click attribution to enter profiles"
root_cause: "scope_issue"
resolution_type: "code_fix"
severity: "medium"
tags: [recommendations, playback, profiles, recency, clock-skew, postgres]
---

# Shared source-neutral short-watch feedback

## Problem

The original below-player history joined playback through recommendation requests,
missing direct/search/editorial viewing. The follow-up homepage report exposed a
second mismatch: only finalized qualified watches entered homepage history, while
below-player history accepted starts. A 20-second watch could therefore leave the
homepage unchanged even though actual playback evidence had been accepted.

## Symptoms

- Started videos with a null recommendation request were absent from recent
  context, even when the active profile authorized their sessions.
- A draft repair compared client `occurred_at` against server episode creation.
  That excluded valid starts buffered while context issuance was still pending.
- A full profile slate prevented curated retrieval, even when all its videos
  had just been tried. Moving watched items only within that slate was insufficient.
- Qualified recommendation-origin episodes were additionally gated by selection
  attribution during profile projection; standalone episodes had no such gate.

## What Didn't Work

Joining more recommendation requests cannot recover source-neutral episodes.
Equating qualification with completion also misdiagnoses legitimate continuation
or deterministic refill. Comparing a browser timestamp directly with server
creation time is inconsistent with the capability's accepted clock allowance.
Waiting for a qualified outcome cannot provide short-watch responsiveness, and
lowering the durable-interest threshold would conflate temporary freshness with
lasting preference. A client-side shuffle would not fix either API's evidence use.

## Solution

`apps/admin/src/services/recommendations/recent-playback.sql.ts` defines the
shared policy used by `recent-context.service.ts` and `user-history.service.ts`:

- Require a real `playback_start` plus at least 3,000 ms of accepted
  `playback_active_visible_playing` intervals in an episode. Union overlapping
  intervals instead of adding duplicate coverage. A seek, click, bare start,
  hidden time or passive preview alone does not qualify.
- Read accepted facts before asynchronous finalization. Use a 24-hour server
  receipt window, excluding its lower boundary. Recently tried is temporary
  context, not completion, an explicit dislike or a durable interest.
- Read at most 32 episode roots per authorized session, with at most eight
  sessions and 24 recent videos. Homepage history separately retains up to 24
  qualified videos, so short watches cannot crowd out completed-view exclusions.
- Preserve discovery source as attribution, not a prerequisite. Search, direct,
  share, acquisition, editorial and recommendation viewing use the same policy.

Episode creation remains fenced by authorization start, current profile privacy
generation, the seven-day root window and expiry. Conflicted episodes, suspicious
replays, expired facts and episodes with late evidence are excluded. Recency uses
server `received_at`; ingestion has
already verified the event against its episode capability, including the bounded
client-clock allowance. Profile authorization names in the implementation do not
introduce a consent-prompt prerequisite; follow the current
[enablement policy](../../analytics-and-recommendation-policy.md).

`composeUserRecommendations` orders fresh profile, fresh curated, recently tried
profile, then recently tried curated candidates. A full profile slate containing
recently tried videos can trigger curated retrieval. If that optional retrieval
fails, a complete eligible profile slate remains a valid reserve. Short-only
history is excluded from curated thematic-interest inputs. Existing seven-day
completion and partial-watch rules remain separate.

`RecommendationDeliveryService` loads recent context once and applies it in
semantic, cold-profile, hybrid and fallback execution. Curated fallback excludes
the current video at retrieval, then uses the same fresh-first/reserve composition
as other lanes. Both composers match canonical Core identities. A history failure
is explicit, not silently treated as an empty history; request deadlines remain
unchanged.

In `profiles/profile-projection.service.ts`, qualified watch contributions no
longer require a recommendation selection or attributed impression. Episode
authorization, current integrity decisions, privacy generations, expiry,
supersession and rollback fences remain. Click-only session intent still requires
selection/impression attribution. Qualified-view thresholds are unchanged.

The existing `(session_digest, created_at DESC, id DESC)` index supports bounded
episode lookup without scanning unrelated viewers. Its original migration uses ordinary
transaction-compatible DDL with a two-second lock timeout and a fifteen-second
statement timeout. It briefly blocks writes while building; a timeout fails the
deployment and requires inspection and Prisma failure resolution before retry.
No new identity or retained history table is introduced. The short-watch extension
needs no new migration or GraphQL schema change.

## Why This Works

Both learning and recency understand playback without recommendation lineage.
The authorization boundary remains the server-issued episode and active profile
link, while server receipt time avoids rejecting valid queued browser events.
The final composer decides whether recent videos can refill a sparse row. The
same evidence changes both APIs on their next request without waiting for durable
interest publication. This does not make an already-rendered row update in place.

## Prevention

- Test all six origins against real PostgreSQL, through context/selection claim,
  fact ingestion, history readers, outcome classification, profile publication
  and subsequent candidate retrieval. Include a card selection with no impression.
- Test 2,999 versus 3,000 ms, overlapping and contiguous intervals, the exact
  24-hour boundary, start-only and preview-only episodes, and pending finalization.
- Include pre-link, expired, reset, foreign-session, conflicting and late evidence.
- Test buffered starts and client clocks ahead of or behind the server; do not
  repeat token timestamp validation with stricter downstream assumptions.
- Bound roots before joining facts, and inspect the actual query plan with many
  unrelated episodes. An output `LIMIT` alone does not bound the expensive join.
- Distinguish a recently-tried preference, qualified viewing, completion and an
  explicit reaction. An immediate exit has unknown preference meaning.
- Inspect actual rejected-stage reason codes; a composed position movement alone
  is not proof of prior suppression.
- Run the Admin-wide migration safety guard as well as the focused database suite.
  A successful isolated migration does not prove compatibility with the repository's
  migration runner. Concurrent index DDL is forbidden in Prisma migrations here.

## Related Issues

- [Source-free profile and curated reserve boundaries](../architecture-patterns/source-free-recommendations-profile-first-curated-reserves-20260910.md).
- [Implementation verification](../../operations/recommendation-quality-validation-2026-09-15.md).
- `apps/admin/src/services/recommendations/recent-context.db.test.ts` contains the
  shared-surface, origin, authorization, clock, interval and query-plan coverage.
- `apps/admin/src/services/recommendations/profiles/profile-projection.service.db.test.ts`
  proves all-source short-watch context and subsequent qualified learning.
- [feat-533 verification and refresh record](../../validation/feat-533-short-watch-feedback.md).
