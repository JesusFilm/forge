---
id: "feat-888"
title: "Move recommendation event history out of serving PostgreSQL"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 14
depends_on:
  [
    "feat-889",
    "feat-890",
    "feat-891",
    "feat-892",
    "feat-893",
    "feat-894",
    "feat-895",
    "feat-896",
  ]
blocks: []
tags:
  - "recommendations"
  - "storage"
  - "clickhouse"
  - "admin"
---

## Problem

Raw recommendation and Watch evidence, its indexes, and its cleanup share the
serving PostgreSQL database. The owner authorized designing and shipping a
ClickHouse event-store migration, with an explicit grill-with-docs interview
before implementation. On 28 October the owner accepted recommendation/Watch
scope, five-minute learning freshness, continued valid serving during event-store
outages, and unchanged retention. The owner subsequently accepted a dedicated
Forge ClickHouse service, a bounded temporary PostgreSQL outbox, and unexpired
history backfill, then a 24-hour outage buffering target. Automatic durable
retry during outages is required. Sink qualification, measured buffer sizing
and exact delivery guarantees are engineering work; priced infrastructure and
release choices remain open. The owner rejected repeating the architecture
recommendation as a confirmation question. The duration is a planning
placeholder, not a delivery commitment.

## Entry points

- `docs/plans/2026-10-28-recommendation-event-storage-spec.md`
- `CONCEPTS.md` — Recommendations vocabulary.
- `docs/analytics-and-recommendation-policy.md`
- `apps/admin/src/services/recommendations/watch-surface-exposure.service.ts`
- `apps/admin/src/services/recommendations/playback-outcome-consumer.ts`
- `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts`
- `apps/admin/src/services/recommendations/cowatch/projection.service.ts`
- `apps/admin/src/services/recommendations/precomputed/engagement-evidence.ts`

## Grep these

`WatchSurfaceExposure`, `RecommendationPlaybackFact`,
`RecommendationOutcomeRevision`, `readPlaybackOutcomeEnvelope`,
`loadCowatchSourceRows`, `RECOMMENDATION_PROFILE_PROJECTION_COALESCE_MS`.

## Delivery

Implementation was authorized on 28 October via `implement-spec`. Execute the
linked task graph on `codex/recommendation-event-storage-integration`, validate event and report
parity, release through the normal PR-to-main flow, and measure actual
PostgreSQL retirement and storage effects. Preserve the running experiment,
privacy controls, expiry, playback attribution, and recommendation serving.

No implementation, infrastructure purchase, data cutover, or production deletion
has occurred under this ticket. Existing capacity work in platform feat-554 and
feat-756 remains independent and open; this migration does not complete it.
