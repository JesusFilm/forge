---
title: "Infer Watch media-collection CTA destinations at block level"
date: 2026-07-15
category: docs/solutions/design-patterns
module: apps/admin, apps/web
problem_type: design_pattern
component: watch_home_media_collection
severity: medium
related_components:
  - MediaCollectionBlock
  - MediaCollection
  - WatchHomeExperiencePage
tags:
  - watch-home
  - media-collection
  - admin-graphql
  - canonical-url
  - dataloader
  - performance
applies_when:
  - "A Watch media collection needs a useful CTA without an authored Admin link"
  - "Every manually authored item belongs to the same visible parent collection"
---

# Infer Watch media-collection CTA destinations at block level

## Context

Experience-authored media collections can omit `ctaLink`. A generic fallback to
`/watch/languages` makes a collection such as Lumo lose its context, even when
every item is linked to the same Lumo parent in Admin.

## Pattern

Expose one nullable block-level GraphQL scalar, `defaultCollectionSlug`, rather
than parent metadata on every card. For manual blocks, resolve the visible
parent relations for all linked items with DataLoader, load the unique parents,
and return the first valid parent from the first item's relation order that is
shared by every item. Return `null` for empty, unlinked, mixed, missing, or
deleted parents.

For `routeVideoChildren` blocks, skip those lookups entirely. The web renderer
already has the route video's slug and can use it as the collection slug.

Build the public destination with the canonical two-segment Watch URL:

```text
/watch/{collection}.html/{audio-language}.html
```

Use this precedence:

1. A non-empty authored `ctaLink` from Admin.
2. The current route video's slug for `routeVideoChildren`.
3. Admin's inferred `defaultCollectionSlug` for manual collections.
4. The existing `/watch/languages` fallback when no safe collection exists.

## Why block-level inference

The client receives a single optional scalar and performs no new client-side
fetching, hydration, or initialization. Manual blocks add at most two batched
loader operations: item-to-parent relations and unique parent records. Mixed
collections deliberately keep the generic fallback instead of choosing an
arbitrary destination.

## Verification

- Resolver tests cover common, mixed, unlinked, and route-derived collections.
- Web tests cover inferred canonical links, Admin override precedence, route
  collection inference, and the generic fallback.
- Regenerate `apps/admin/schema.graphql` and the `packages/admin-graphql`
  gql.tada environment whenever this field changes.
