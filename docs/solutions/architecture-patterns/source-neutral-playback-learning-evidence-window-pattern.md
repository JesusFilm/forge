---
title: "Keep source-neutral playback learning exact from context to evaluation"
date: "2026-09-02"
category: "architecture-patterns"
module: "apps/admin and apps/web recommendation playback evidence"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "Playback behavior should be learnable regardless of how the viewer reached the player"
  - "Browser activity intervals can pause, seek, hide, retry, or finish concurrently"
  - "A derived playback proxy needs privacy-bounded evidence before any serving use"
  - "A rolling migration must preserve older recommendation-attributed playback writers"
tags:
  - "recommendations"
  - "playback-evidence"
  - "source-neutral"
  - "active-playback"
  - "privacy"
  - "idempotency"
  - "concurrency"
  - "readiness"
related_components:
  - "database"
  - "frontend_stimulus"
  - "background_job"
  - "testing_framework"
---

# Keep source-neutral playback learning exact from context to evaluation

## Context

Recommendation-attributed playback was too narrow a root for learning from the
full-player experience. Search, share, acquisition, editorial, and direct
arrivals can produce the same behavioral evidence, but inventing a
recommendation request for those paths would fabricate credit and couple
learning eligibility to discovery source.

The source-neutral design adds a Playback Context above the existing episode.
It admits an allowlisted source and optional opaque source reference, while
recommendation lineage is present only for a recommendation arrival
(`apps/admin/src/services/recommendations/contracts.ts:33-66`,
`apps/admin/prisma/schema.prisma:3522-3554`). The migration backfills existing
episodes and temporarily bridges N-1 writers without weakening the new
context-required invariant
(`apps/admin/prisma/migrations/0072_recommendation_source_neutral_playback/migration.sql:67-150`).

The difficult part is not adding another source enum. The browser, database,
classifier, profile projection, retention workflow, and operator evaluation
must all agree on one immutable evidence lineage while remaining best effort
for playback availability and disabled until separately activated.

## Guidance

### Separate provenance from evidence semantics

Make discovery source diagnostic provenance on the immutable context, not an
input to classification, eligibility, or weight. Each context owns exactly one
episode; recommendation request, item, and selection fields are nullable
together and are copied only when that lineage really exists
(`apps/admin/prisma/schema.prisma:3522-3569`). The proxy evaluator scopes rows by
context creation window and deliberately omits discovery source from its
predicates and readiness math
(`apps/admin/src/services/recommendations/playback-proxy-evaluation.service.ts:233-267`).

Use a context idempotency key bound to pseudonymous session and media identity.
On replay, require the same source and source-reference digest before returning
the original capability. Recheck the versioned evidence control inside the
creation transaction so disabling or changing the control cannot race a claim
that read an older value
(`apps/admin/src/services/recommendations/playback-context.service.ts:121-171`,
`apps/admin/src/services/recommendations/playback-context.service.ts:194-247`).

### Measure active playback as exact intervals

Active playback is the intersection of playing, visible, and not seeking. Flush
the current interval before pause, buffering, seek, page hiding, terminal
events, or route exit, and restart only when all conditions are true. Store the
interval endpoints and bounded duration rather than inferring activity later
from sparse progress positions
(`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:398-470`,
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:487-643`).

Keep event identity stable across transport retries. A failed batch remains in
the ordered queue with its original event IDs and payloads, so Admin can treat
an exact replay as idempotent and quarantine a conflicting payload instead of
double-counting it
(`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:231-279`).
Player behavior must remain fail-open when context issuance or fact delivery is
unavailable.

### Publish revisions from one serialized episode boundary

Classifiers consume the same ordered fact watermark and input digest. Equal
input returns the existing result, a later watermark appends a superseding
revision, and a lower watermark is fenced
(`apps/admin/src/services/recommendations/outcome.service.ts:306-381`). Use the
episode advisory lock as the serialization boundary, but let a waiter take a
fresh post-lock database snapshot. In this implementation that means Read
Committed: a Serializable transaction can retain a pre-wait snapshot and try
to publish the frozen input twice
(`apps/admin/src/services/recommendations/outcome.service.ts:427-432`).

Keep eligibility separate from immutable classifier output. A current,
versioned eligibility decision determines whether an outcome can enter a
profile projection; the outcome's compatibility flag stays false
(`apps/admin/prisma/schema.prisma:3674-3750`). When rebuilding a projection,
advance its evidence watermark from every current decision in scope, including
exclusions. Otherwise a superseding exclusion can remove the last contribution
without changing the rebuild identity, causing an old non-empty generation to
replay
(`apps/admin/src/services/recommendations/profiles/profile-projection.service.ts:499-565`).

### Treat proxy readiness as offline evidence, not activation authority

Publish readiness as an append-only aggregate keyed by exact window, input
watermark, and digest. The record contains no viewer, session, context, request,
item, profile, or capability identity and explicitly has no serving authority
(`apps/admin/prisma/schema.prisma:4196-4209`). Retention health, write failures,
coverage, lag, conflicts, revisions, cohort size, and comparator signal can
produce inconclusive, revise, retire, or eligible-for-shadow-evaluation states
(`apps/admin/src/services/recommendations/playback-proxy-evaluation.service.ts:70-125`).

Eligibility for shadow evaluation is not permission to alter serving. Applying
the migration seeds the collection control disabled, and every aggregate record
declares no serving effect
(`apps/admin/prisma/migrations/0072_recommendation_source_neutral_playback/migration.sql:422-467`).
Activation, shadow comparison, and any eventual serving decision are separate
operator-governed changes.

## Why This Matters

Source neutrality prevents discovery channels from receiving invented credit
and lets one behavior contract cover every eligible player arrival. Exact
intervals prevent hidden, paused, buffered, and seeking time from masquerading
as engagement. Immutable revisions and current eligibility decisions preserve
auditability when late facts change the answer. Aggregate-only readiness lets
operators judge the proxy without turning raw playback history into a durable
identity surface or allowing evaluation code to influence recommendations.

These guarantees reinforce one another. A source-neutral row without exact
episode lineage is ambiguous; an exact interval without idempotent replay can
double-count; an append-only outcome without a decision watermark can replay a
stale projection; and a high-quality evaluation without a disabled activation
boundary can accidentally become serving policy.

## When to Apply

- Multiple discovery paths converge on one playback experience.
- Browser telemetry is optional for product availability but consequential for
  later learning.
- Late facts may revise an already finalized behavioral classification.
- Profile or aggregate consumers need current eligibility rather than historic
  classifier truth.
- A new behavioral proxy must earn the right to proceed through bounded,
  privacy-safe offline evidence.
- Old and new application versions overlap during a forward-only migration.

## Examples

The implementation rejected several superficially safe shortcuts:

- Inferring recommendation provenance whenever source data was absent would
  fabricate attribution; absent provenance becomes direct.
- Leaving an active timer running across a seek would count time spent seeking;
  seeking flushes the interval and seeked starts a new one.
- Checking the collection control only before a transaction would admit a
  disable race; the transaction verifies both enabled state and version.
- Combining an advisory lock with a stale Serializable snapshot could still
  duplicate publication; the waiter needs a fresh snapshot after the lock.
- Building a projection digest only from included contributions would miss a
  removal-only eligibility change; current excluded decisions also advance the
  evidence watermark.
- Treating readiness as a boolean would collapse "not enough evidence,"
  "instrumentation unhealthy," and "proxy should be retired" into the same
  operational answer.

Real PostgreSQL tests should prove migration/backfill shapes, exact lineage
constraints, concurrent finalization replay, and removal-only projection
rebuilds. Browser verification should prove both the evidence-visible Admin
trace and the player fail-open journey when every playback-evidence request is
aborted.

## Related

- [Production recommendation boundary hardening](production-recommendation-boundary-hardening-pattern.md)
- [Recommendation consent refresh admission race](../ui-bugs/watch-recommendation-consent-refresh-in-flight-admission-race.md)
- [Admin trace retention pattern](../platform/admin-search-trace-retention-pattern.md)
