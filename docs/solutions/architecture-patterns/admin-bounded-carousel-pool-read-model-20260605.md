---
title: Admin bounded carousel pool read model
date: "2026-06-05"
area: architecture-patterns
related:
  - docs/roadmap/platform/feat-160-watch-home-carousel-data-parity.md
  - docs/plans/2026-06-05-003-feat-watch-home-carousel-bounded-pools-plan.md
  - docs/solutions/architecture-patterns/admin-owned-watch-route-manifest-20260530.md
  - docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md
---

# Admin Bounded Carousel Pool Read Model

## Context

Forge's `/watch` home page needed source-parity TV carousel playlist pools from admin data. The tempting path was to add every upstream playlist Core ID to the broad `watchHomeVideos` query and project children plus dubs through normal GraphQL relations. That can exceed SSR timeouts because large collection rows multiply into `sources x children x dubs`.

## Pattern

Keep broad home/page composition queries narrow. When a consumer needs expensive relation walking for a specialized surface, add a producer-owned admin read model that returns:

- caller-ordered source rows,
- a full count in the same visibility/playability scope,
- a clamped candidate window,
- enough parent metadata for route construction,
- normal admin entities only after the service has bounded the source set.

For public admin GraphQL, prefer service-mediated object refs over direct nested relation expansion when the resolver needs request-specific caps, source ordering, count/window pairing, or fallback behavior.

## Implementation Notes

- Cap source IDs with the same explicit validation posture used by adjacent video lookup contracts.
- Clamp per-source limits server-side; do not rely on the client-supplied `limit`.
- Apply public visibility and playability filters in the service before returning candidates.
- Avoid public endpoint query fan-out with unbounded `Promise.all`. Process sequentially or use an explicit small concurrency limit if the endpoint genuinely needs parallelism.
- Keep web fallback paths during deploy ordering when admin schema and web code may not reach production at exactly the same time.

## When To Reuse

Use this for admin-backed consumer surfaces that need a small, curated slice of large media relations: hero playlists, rails, route manifests, recommendation pools, or editorial collections where the source truth belongs in admin but the consumer cannot afford full graph rediscovery at request time.
