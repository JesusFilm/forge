---
title: "Watch language inventory portrait thumbnails use delimited catalog markers"
date: "2026-08-29"
category: "ui-bugs"
module: "apps/web Watch language inventory"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Vertical episodes appeared in landscape thumbnail frames on language inventory collection rows."
  - "The thumbnail shape contradicted the vertical format even when catalog identifiers or titles carried a vertical marker."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx"
  - "apps/web/src/components/watch-language-inventory/__tests__/LanguageInventoryPage.thumbnails.test.tsx"
tags:
  - "watch-page"
  - "language-inventory"
  - "portrait-thumbnail"
  - "vertical-video"
  - "responsive-images"
  - "core-id"
---

# Watch language inventory portrait thumbnails use delimited catalog markers

## Problem

Compact episode rows used one fixed landscape frame for every video. Vertical
episodes therefore appeared as landscape crops even when their catalog data
identified them as vertical media.

## Symptoms

- A vertical episode used the same `h-12 w-20 sm:h-14 sm:w-24` frame as an
  ordinary landscape episode.
- The artwork was anchored at the top left instead of centered in a portrait
  frame.

## What Didn't Work

- Applying portrait geometry to the whole collection would also reshape
  ordinary episodes and collection artwork outside the compact row.
- Adding an orientation query field or requesting another image would expand a
  render-only presentation fix into a data and media contract change.
- Substring matching without token boundaries would misclassify lookalike
  values such as `verticality` or `9x160`.

## Solution

Derive the compact row orientation from fields already present on the inventory
card. Match `vertical` or `9x16` only when delimited by non-alphanumeric
boundaries, and check stable identifiers before localized title fallbacks:

```tsx
const PORTRAIT_INVENTORY_MARKER =
  /(?:^|[^a-z0-9])(?:vertical|9x16)(?=$|[^a-z0-9])/i

const isPortrait =
  hasMarker(item.coreId) ||
  hasMarker(item.slug) ||
  hasMarker(item.parentSlug) ||
  hasMarker(item.title) ||
  hasMarker(item.parentTitle)
```

Keep the existing responsive heights and branch only the width, image position,
and responsive image hint:

```tsx
isPortrait ? "h-12 aspect-[2/3] sm:h-14" : "h-12 w-20 sm:h-14 sm:w-24"
```

Portrait rows use centered artwork and `sizes="(max-width: 640px) 32px, 37px"`.
Landscape rows retain their top-left alignment and existing 80/96 px sizing
hint. The row link, play affordance, focus frame, metadata, and image node remain
shared.

## Why This Works

The catalog already carries the required format signal, so the render can
select the correct geometry without another query, effect, image, or derivative
recipe. The token boundary keeps the signal narrow, while the parent and title
fallbacks cover localized inventory data whose child identifier may omit the
marker.

## Prevention

- Test every accepted marker source and keep a normal landscape row as the
  control case.
- When a thumbnail frame becomes narrower, update its `sizes` hint with the CSS
  geometry so the browser does not select a landscape-sized candidate.
- Keep orientation changes at the smallest surface that has the proven signal;
  do not infer that all artwork in a vertical collection shares one shape.

## Related Issues

- [Watch authored carousel variants must render as horizontal rails](./watch-authored-media-collection-responsive-card-density.md)
- [TV Home orientation is not the card-shape signal](../logic-errors/tv-home-orientation-field-overloaded-card-shape-signal.md)
