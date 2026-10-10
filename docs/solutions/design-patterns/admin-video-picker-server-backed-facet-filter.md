---
title: Admin video picker facet filters must be server-backed and composable
date: 2026-07-21
category: design-patterns
module: apps/admin experience editor
problem_type: design_pattern
component: service_object
severity: medium
applies_when:
  - "Adding catalog facets to an Admin picker that preloads only one result page"
  - "Combining a structured category with ranked text search"
  - "Reusing Video Library taxonomy in an embedded editor flow"
tags:
  - admin
  - experience-editor
  - video-picker
  - faceted-search
  - server-actions
  - video-library
---

# Admin video picker facet filters must be server-backed and composable

## Context

The Experience editor video picker initially loaded a small first page and used
a server action only after an editor entered text. Adding a category control as
a client-only filter would look correct for visible rows but silently omit
matching videos beyond that preload. It would also risk defining a second set
of labels and database mappings apart from the main Video Library.

## Guidance

Treat a structured picker facet as part of the server query whenever it can
change which rows qualify. Use the Video Library's canonical category type,
labels, parser, and database predicate at both the client and action boundary.

The server row loader should compose the category predicate with ranked text
search rather than choosing between them:

```ts
const where = andVideoLibraryWhere(
  rankedSearchWhere,
  buildVideoLibraryCategoryWhere(category),
)
```

Keep category-only requests server-backed as well. Blank text should suppress
search tracing, not the database request, because the facet still defines a
real result set.

At the action boundary, normalize the incoming category before it reaches the
database helper. TypeScript types do not validate runtime values submitted by a
client:

```ts
const category = parseVideoLibraryCategory(context?.category)
```

The editor can then intersect the returned rows with its existing picker-mode
eligibility and duplicate-exclusion rules without changing their meaning.
Reset both text and facet state when opening a new picker session so a filter
from one block does not leak into the next.

## Why This Matters

A client-only facet over a bounded preload creates plausible but incomplete
results, which is worse than an obvious error for editorial work. Sharing the
canonical taxonomy prevents the Video Library and embedded pickers from
drifting in labels or database semantics. Boundary normalization keeps a
forged or stale client value from turning into an invalid query category.

## When to Apply

- A picker preloads fewer rows than the complete catalog.
- A structured filter must work with and without a text query.
- The parent library already owns the category-to-database mapping.
- The picker adds local eligibility or duplicate rules after server retrieval.

## Examples

Cover each boundary independently:

- category utility tests assert the canonical option list, parser fallback, and
  database predicate;
- loader tests assert category-only and combined text-plus-category inputs;
- component tests assert selection, reset-on-reopen, result narrowing, and
  preservation of picker-specific exclusions;
- browser proof selects a facet with blank text and verifies a real server
  request, visible matching rows, an absent non-matching row, and no console
  errors.

## Related

- [Admin experience media picker should persist asset IDs and resolve app URLs at read boundaries](../best-practices/admin-asset-backed-experience-media-picker-pattern-20260707.md)
- [Admin video picker must trim against the selected locale dub](../logic-errors/admin-editor-video-picker-locale-first-dub-trimming-20260721.md)
