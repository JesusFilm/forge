---
title: "Default a standalone Watch rail without reordering selectable parents"
date: 2026-08-10
category: ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A standalone Watch episode defaults to an auxiliary collection even when it belongs to a feature film."
  - "Changing parent order to fix the default would also change the authored dropdown order."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - watch-page
  - parent-selection
  - feature-film
  - canonical-order
---

# Default a standalone Watch rail without reordering selectable parents

## Problem

A standalone Watch episode can belong to several eligible parents. The
episodes dropdown used the first Admin-ordered parent as both the first option
and the initial selection, so an auxiliary collection could win over the
episode's feature film.

## Symptoms

- Every eligible parent was available, but the first rail was not the most
  relevant film context.
- Reordering the parent array would have made the initial rail look correct at
  the cost of changing authored dropdown order.

## What Didn't Work

- Do not infer a feature film from its title or child count. Feature films can
  have chapter children, so the normalized Admin label is the classification
  authority.
- Do not sort selectable parents to put the preferred parent first. Parent
  order belongs to the Admin relationship and is a separate concern from the
  initial selection.
- Do not make the client rediscover the default. The server already has the
  label and route context, and a client-side scan would add label semantics to
  hydration.

## Solution

Keep eligibility and order unchanged, then derive a separate default identity
from the eligible list:

```ts
const eligibleParents = video.parents.flatMap(/* existing admission rules */)

return {
  selectableParents: eligibleParents.map(
    ({ carouselParent }) => carouselParent,
  ),
  defaultParentDocumentId: eligibleParents.find(
    ({ label }) => videoLabelMessageKey(label) === "featureFilm",
  )?.carouselParent.documentId,
}
```

Pass that identity into the server-side merge layer. Resolve the canonical
carousel parent by ID and fall back to the first eligible parent. The client
then initializes from `canonicalParent.documentId`, while the selector renders
the unchanged `selectableParents` array.

Only standalone routes supply the preferred identity. Contextual Watch routes
continue to use the parent selected by the URL.

## Why This Works

The implementation separates three contracts that previously shared one array
position:

- eligibility decides which parents may appear;
- Admin relation order decides how options appear;
- the default parent identity decides the initial rail and structured data.

The normalized label supports both Admin enum values such as `FEATURE_FILM` and
already-normalized values such as `featureFilm`. The fallback preserves prior
behavior when no eligible feature-film parent exists.

## Prevention

- Test option order and selected identity independently.
- Cover uppercase and normalized label shapes, multiple matches, an ineligible
  preferred parent, and the no-match fallback.
- Keep explicit contextual-route tests beside standalone inference tests so a
  new default cannot override URL-selected context.

## Related Issues

- [Standalone Watch selector contract](../../roadmap/platform/feat-287-watch-standalone-collection-episodes.md)
- [Feature-film default implementation plan](../../plans/2026-08-10-002-fix-watch-feature-film-parent-default-plan.md)
- [Parent/child count is not a video classification](../logic-errors/tv-childcount-not-a-series-container-signal.md)
- [Relation-specific order in aggregated read models](../design-patterns/relation-specific-order-in-aggregated-read-models-20260616.md)
