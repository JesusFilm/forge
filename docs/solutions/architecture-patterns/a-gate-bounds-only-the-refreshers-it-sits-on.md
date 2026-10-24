---
title: "A gate bounds only the refreshers it sits on — enumerate every writer of the joining state before concluding what a closed gate stops"
date: "2026-09-23"
category: "architecture-patterns"
module: "apps/admin recommendation serving gate and profile session linkage (src/graphql/mutations/recommendation-evidence.ts, src/graphql/mutations/recommendation-viewer.ts, src/graphql/mutations/recommendation-profile.ts, src/services/recommendations/profile.service.ts, src/services/recommendations/profiles/profile-projection.service.ts) with apps/mobile/src/lib/recommendations — traced while shipping feat-517, PR #2367"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
root_cause: "incorrect_assumption"
resolution_type: "workflow_improvement"
related_components:
  - "apps/admin/src/graphql/mutations/recommendation-evidence.ts"
  - "apps/admin/src/graphql/mutations/recommendation-viewer.ts"
  - "apps/admin/src/graphql/mutations/recommendation-profile.ts"
  - "apps/admin/src/services/recommendations/profile.service.ts"
  - "apps/admin/src/services/recommendations/profiles/profile-projection.service.ts"
  - "apps/mobile/src/lib/recommendations/viewerIdentity.ts"
applies_when:
  - "Reasoning about what a closed kill switch, feature flag, or environment gate actually stops"
  - "A gate sits on a SERVE or READ path while a RECORD or WRITE path stays open by design"
  - "Some joining state — a session link, a lease, a claim, an enrollment row — connects the two and carries its own expiry"
  - "Planning to ship a client ahead of the server switch that serves it, expecting signal to accumulate in the gap"
  - "Deciding whether switch-on day can use a backlog of evidence already recorded"
symptoms:
  - "A confident answer about what a closed gate stops, derived from the one refresher that sits behind it"
  - "Accumulation that depends on end-user behavior in a way nobody designed or expected"
  - "Regular users building less durable state than lapsed users, for no visible reason"
  - "Rows that are written and retained but unreachable, with no error anywhere"
tags:
  - "recommendations"
  - "kill-switch"
  - "feature-flag"
  - "rollout-sequencing"
  - "data-lifetime"
  - "session-link"
  - "grounding"
  - "profiles"
---

## Context

Mobile shipped a "Recommended for You" shelf on the Home screen; PR #2367 merged
it on 2026-09-23. The shelf reads Admin's `userRecommendations`. Admin does not
serve that query by default: `RECOMMENDATION_SEMANTIC_SERVING_ENABLED` has the
schema default `"false"` (`apps/admin/src/config/env.ts:458-461`), and the
serving state also needs a signer, healthy retention, a serving-control row and
a compatible manifest (`apps/admin/src/services/recommendations/manifest.service.ts:66-104`).
A separate switch, `RECOMMENDATION_USER_SERVING_ENABLED`, defaults to `"true"`
(`apps/admin/src/config/env.ts:449-451`) and only narrows the gate.

That raised a release-planning question. If the client ships first and serving
stays off for weeks, does ordinary use build a recommendation profile in the
background, so an operator flips the switch onto a warm shelf?

The first traced answer was a confident **no**, and it was wrong. The way it was
wrong is the lesson, and it is worth more than the answer.

## Guidance

**A gate bounds only the refreshers it sits on. Before concluding what a closed
gate stops, enumerate every writer of the joining state — then check which of
them the gate actually sits on.** Finding one refresher behind the gate is not
evidence that it is the only one.

The recommendation stack shows both the trap and the correction.

**What is genuinely ungated.** The evidence mutations declare
`authScopes: { public: true }` with no serving-state check:
`issueWatchPlaybackContext`
(`apps/admin/src/graphql/mutations/recommendation-evidence.ts:157-160`) and
`recordSemanticRecommendationPlayback` (`:290-293`). A profile is created at
viewer bootstrap, where a `grant` transition creates the row and links the
session in one transaction
(`apps/admin/src/services/recommendations/profile.service.ts:502`).

**The joining state, and its short life.** A profile reaches recorded behavior
only through a profile-to-session link. That link lives 24 hours
(`apps/admin/src/services/recommendations/contracts.ts:22`,
applied at `profile.service.ts:923-950`) while the profile itself lives 180 days
(`profile.service.ts:25`). The durable projection query joins that link,
requires it to be live, and admits only episodes at or after it:

```sql
JOIN recommendation_profile_session_link link
  ON link.profile_id = profile.id
  AND link.privacy_generation = profile.privacy_generation
  AND link.expires_at > ${input.now}
...
AND COALESCE(episode.claimed_at, episode.created_at) >= GREATEST(profile.created_at, link.linked_at)
```

That join and its lower bound are at
`apps/admin/src/services/recommendations/profiles/profile-projection.service.ts:442-447`
and `:467`.

**The trap: one refresher sits behind the gate, and it is the obvious one.**
`authorizeProfile` upserts the link with a fresh expiry
(`apps/admin/src/services/recommendations/delivery.factory.ts:130-154`). Both of
its callers sit after a serving-state check that returns early when it cannot
issue (`user-delivery.service.ts:271-279` before `:292`, and
`delivery.service.ts:145-152` before `:179`). Serving off means this refresher
never runs. Stopping the trace here yields "the link dies and nothing revives
it", which is a clean, mechanically-supported, wrong conclusion.

**The correction: `linkSession` has four call sites, and one is ungated.**
Three are the `grant` and `reset` transitions (`profile.service.ts:482`, `:502`,
`:547`). The fourth is `profile.service.ts:350`, which sits inside `status()`
(the method declarations either side are `status(` at `:177` and `transition(`
at `:358`). Two public mutations reach `status()` with no serving check:
`updateRecommendationViewer`
(`apps/admin/src/graphql/mutations/recommendation-viewer.ts:41-44`, reaching
`viewer-identity.service.ts:123`) and `recommendationProfileStatus`
(`apps/admin/src/graphql/mutations/recommendation-profile.ts:102-105`, reaching
`:116`). Both also dispatch a projection rebuild with no serving check —
`recommendation-profile.ts:125` and
`viewer-identity.service.ts:184`, the latter guarded only by an active receipt
(`:178-183`). The receipt lives the full profile lifetime
(`profile.service.ts:457`), so this path stays open for 180 days.

**And the client really does call it.** Mobile sends
`updateRecommendationViewer` with action `status`
(`apps/mobile/src/lib/recommendations/viewerIdentity.ts:272-274`), but only when
the install has been idle past a threshold —
`SESSION_INACTIVITY_ROTATION_MS` is 24 hours (`:23`), checked at `:257`. That
check runs inside the identity resolve behind every `get()` (`:361`), and the
playback recorder resolves identity for every video played
(`apps/mobile/src/lib/recommendations/playbackRecorder.ts:525`), gated only by
the opt-out client flag and a bearer (`playbackRecorderClient.ts:43`;
`enabled.ts:9-11` defaults on). Nothing there consults delivery, so a closed
serving gate suppresses none of it.

**The resulting behavior is perverse, which is why nobody would guess it.**

| Viewer                         | What happens while serving is off                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opens the app most days        | The idle threshold never trips, so the link is never refreshed after bootstrap. Roughly the first day counts; later watching is recorded, retained and unreachable. |
| Returns after a gap over a day | The session rotates, `status` refreshes the link, and another window of watching counts. Every return grants another.                                               |

So the regular viewer accumulates _less_ durable profile than the lapsed one.
Nothing in the design intends that; it falls out of an inactivity timer on the
client meeting an expiry on the server.

**Release-planning consequence.** Landing the client well before the server
switch does not buy a clean warm-up, but neither does it buy nothing. It buys an
intermittent one skewed toward infrequent users, bounded by raw-evidence
retention (`contracts.ts:33`, inherited at `episode.service.ts:140` and
`outcome.service.ts:404`). Plan the gap deliberately rather than assuming either
extreme.

## Why This Matters

The wrong answer was not careless. It followed a real refresher to a real gate
and stopped, and every layer agreed: the mutations return success, the rows
appear, the profile row exists, and no log reports a problem. The consumer's
early return is correct for an expired link. The projection predicate is correct
data hygiene. Only the join between the paths expires, and no layer owns it.

The cost of being wrong runs both ways. Believing in a warm-up and launching to
a cold shelf reads as a bug in the new client. Believing in no warm-up hides a
real, if lopsided, accumulation, and hides that your most engaged users are the
ones it reaches least.

The deeper cost is the method. A single-refresher trace produces a confident
statement with citations attached, which is exactly the kind of claim that gets
believed later without re-checking.

## When to Apply

Apply this whenever a switch gates one side of a pair and not the other, and
something with its own lifetime joins them.

1. **Enumerate every writer of the joining state.** Search for the function that
   creates or refreshes it and list all call sites, then ask of each whether the
   gate sits on it. Do not stop at the first refresher that is gated.
2. **Follow each ungated writer out to its entry point.** A refresher is only
   reachable in practice if something public reaches it and a client calls it.
   Check both halves; an ungated server path no client calls is inert.
3. **Ask what the client's own timers do.** Here the accumulation shape is set
   by an inactivity threshold in the app, not by anything on the server. Client
   scheduling can make server state depend on user behavior in ways no server
   reading reveals.
4. **Then ask whether switch-on recovers the backlog.** A predicate anchored to
   the new join's timestamp excludes older rows even though they are present,
   and independent retention sets the ceiling on anything you might backfill.

Two adjacent signals. A sweeper or reconciliation job that repairs existing
records rather than creating first ones reads like a safety net and is not one
(`apps/admin/src/services/recommendations/profiles/reconciliation.service.ts:87-143`).
And a glossary entry describing a
resolution chain will not mention lifetimes, so it cannot tell you this.

## Examples

**The trace that produced the wrong answer.** Find `authorizeProfile`, confirm
both callers sit behind the serving check, conclude the link dies after a day
and nothing revives it. Every citation in that chain is accurate. The conclusion
is still wrong, because `linkSession` has a fourth call site inside `status()`
that the search for "who refreshes the link" missed by looking only where
delivery runs.

**A method note, because the glossary misled the first pass too.** An earlier
answer in the same investigation claimed browsing-originated watching does not
feed the profile, reasoning from `CONCEPTS.md`, which describes eligible
recommendation behavior alongside a lane and experiment vocabulary
(`semantic_control`, `profile_challenger`, `semantic_fallback`, `executionMode`
— `CONCEPTS.md:1016-1025`). That vocabulary belongs to a different surface, the
seeded below-player rail served by `semanticRecommendationDelivery`. The
`userRecommendations` path joins by session digest
(`profiles/profile-projection.service.ts:442-447`) and never reads
`discoverySource`. PR #2392 later removed the click-attribution conditions
outright, recording the reason in the source: "Qualified playback is independent
of click attribution."

Both mistakes share one shape: a confident negative drawn from a partial
enumeration. The glossary told part of the domain; the gated refresher was part
of the refresher set. Read the query, and list all the writers.

## Related

- [Kill-switch completeness follows data lifetime](kill-switch-completeness-follows-data-lifetime.md)
  — the mirror. There a flag gates the WRITE path while the read path stays
  open, so too much _survives_ a flip. Here a flag gates the SERVE path while
  record and status paths stay open. Its three diagnostic questions assume the
  write-gated direction, so they cannot surface this; its "cached
  recommendations" phrasing makes it look as though it already covers this
  subsystem.
- [Kill-switch reach follows its slowest artifact channel](kill-switch-reach-follows-its-slowest-artifact-channel.md)
  — the third member of the same family: where a flag's off state cannot travel.
- [Lifecycle protection keyed to a transient marker dies with the marker](../design-patterns/lifecycle-protection-keyed-to-transient-marker-dies-with-marker.md)
  — the closest mechanism sibling: a guard keyed to transient state that a
  separate, legitimate lifecycle rule clears.
- [Anonymous Watch testers use scoped signed capabilities](anonymous-watch-testers-use-scoped-signed-capabilities-20260921.md)
  — prior art on the same hazard class. A 24-hour link proved too short for that
  pilot and was extended, five days before this surfaced.
- [Source-free recommendations: profile-first curated reserves](source-free-recommendations-profile-first-curated-reserves-20260910.md)
  — **refresh candidate.** It describes the handle-to-profile-to-session chain as
  a durable resolution chain and never mentions the link's expiry. Its
  readiness-boundary checklist also omits link freshness.

## Open thread

The same authorization lower bound is written at five sites, so changing it is a
sweep rather than a one-line fix (all verified 2026-09-23):

- `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts:272` and `:467`
- `apps/admin/src/services/recommendations/recent-context.service.ts:69`
- `apps/admin/src/services/recommendations/user-history.service.ts:31`
- the `linked_at` / `expires_at` pair in `apps/admin/src/services/recommendations/viewing-mode.service.ts:50`

Issue #2140 (open, rolling profile renewal) scopes the session clock out of its
change: "Session intent still expires within 24 hours." If that clock is the one
backing `recommendation_profile_session_link`, landing #2140 as written would
renew the profile and leave the join reaching it just as short-lived. Worth
checking against the schema rather than assuming that ticket covers this.

Unmeasured: how the two viewer populations in the table above actually split in
production. The lopsided accumulation is derived from the code, not observed.
