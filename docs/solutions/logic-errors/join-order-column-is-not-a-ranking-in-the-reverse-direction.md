---
title: "A join table's order column ranks one direction only — reading it from the reverse side is coincidence"
date: 2026-08-28
category: logic-errors
module: apps/web
problem_type: logic_error
component: backend_data_layer
symptoms:
  - "Standalone /watch/<slug>.html opened its sibling carousel on a curated seasonal collection instead of the film the video is a chapter of"
  - "The wrong default was stable and deterministic, so it read as an authoring decision rather than a bug"
  - "Structured-data ItemList for the page described the collection's children, not the film's"
  - "No test could see it: every fixture built parents by hand in the order the assertion expected"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - graphql_layer
tags:
  - video-relations
  - watch-route
  - sibling-carousel
  - ordering
  - bidirectional-joins
---

# A join table's order column ranks one direction only

## Problem

`VideoRelation` is one row per `(parent, child)` edge with a single `order`
column. That column was introduced in
`docs/plans/2026-06-14-001-fix-watch-video-relation-order-plan.md` to preserve
Core's chapter sequence — it answers **"which chapter am I inside this
parent?"**

Admin sorts _both_ relation directions with the same comparator
(`videoRelationOrderBy` in `apps/admin/src/graphql/loaders.ts` and
`apps/admin/src/graphql/types/video.ts`):

```ts
const videoRelationOrderBy = [
  { order: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
]
```

For `Video.children` that is exactly right. For `Video.parents` it silently
becomes **"rank containers by this video's index inside each of them"** — a
number about the _child's_ position, used as a ranking of _parents_.

`apps/web` then took `parents[0]` as the standalone watch page's default
carousel container. In production:

| Parent                         | label          | this video's `order` |
| ------------------------------ | -------------- | -------------------- |
| Anticipate the Resurrection    | `COLLECTION`   | 5                    |
| Life of Jesus (Gospel of John) | `FEATURE_FILM` | 41                   |

5 < 41, so a seasonal playlist beat the film the clip is a chapter of on
`/watch/the-arrest-of-jesus-and-peter-denial.html`. Nothing was misconfigured;
the ranking key simply had no meaning in that direction.

## Why it hid

Three things kept this invisible:

1. **It looks authored.** The result is deterministic and repeats across
   deploys, so it reads as an editorial choice rather than a defect.
2. **Adding the `orderBy` to `parents` was a reasonable change.** It was added
   for query determinism, and determinism is what it delivered — the bug is
   that a _deterministic_ order was then read as a _meaningful_ one.
3. **Hand-built fixtures can't catch it.** Every unit test constructed
   `selectableParents` in the order it expected back, so `parents[0]` was
   right by construction. The discriminating fixture is two parents whose
   correct ranking is the _opposite_ of their supplied order.

## Solution

Rank on a property of the parent itself, not on the edge:

```ts
const CONTAINING_WORK_PARENT_LABELS = new Set(["FEATURE_FILM", "SERIES"])

export function rankSelectableCarouselParents(parents: CarouselParent[]) {
  if (parents.length < 2) return parents
  return [...parents].sort(
    (a, b) =>
      Number(isContainingWorkParent(b)) - Number(isContainingWorkParent(a)),
  )
}
```

Deliberately **two tiers, not a full label ranking**. Promoting only
`FEATURE_FILM`/`SERIES` means a page with no containing work — including one
whose labels never arrived — renders exactly as before. A missing or
unrecognized label degrades to the old behavior instead of reshuffling pages
the bug never touched. `Array.prototype.sort` is spec-stable, so within-tier
order stays admin's.

Rank once and use the same array for the default _and_ the picker
(`SiblingCarousel` derives `defaultParent = selectableParents[0]`), or the
dropdown's first entry stops matching what the carousel opened on.

## Testing notes

Three layers, each proving something the others cannot:

- **Unit** (`rankSelectableCarouselParents`): supply the parents in the WRONG
  order and assert the ranked output — a fixture in the expected order is
  vacuous. Include a no-op case (all collections, plus a null label) that pins
  the two-tier boundary.
- **Route** (`page-routing.test.tsx`): the one property threaded at the call
  site (`label: filteredParent.label` in
  `selectableParentsForStandaloneVideo`) is a **silent-revert seam** — deleting
  that single line compiles, typechecks, and restores admin's order with every
  unit test green. Pin it end-to-end. Falsified: dropping the line turns the
  route test red with `expected 'anticipate-the-resurrection' to be
'life-of-jesus-gospel-of-john'`.
- **Normalizer** (`content.test.ts`): assert the raw admin `label` survives
  `normalizeAdminVideo`. Hand-built ranking fixtures stay green even if the
  normalizer drops the field entirely, so this is the only test connecting the
  wire shape to the rule.

Canonicalize the label through whatever normalizer the repo already has,
rather than hand-rolling a compare. Web's `apps/web/src/lib/video-labels.ts`
exports `normalizeLabel` — trim, camelCase and separator to SNAKE_CASE,
uppercase — and `videoLabelMessageKey` applies it to these same labels inside
`SiblingCarousel`. A bare `.toUpperCase()` looks equivalent and is not: it maps
the camelCase spelling `featureFilm`, which appears in web's own route
fixtures, to `FEATUREFILM`, matching nothing. Every spelling mismatch fails in
the silent direction — straight back to the old default — so drive the test
from a spelling table (SNAKE_CASE, lowercase, camelCase, space-separated,
surrounding whitespace) rather than one fixture. Falsified: the naive
`toUpperCase()` reddens exactly the camelCase and space-separated rows, which a
single lowercase fixture would have missed.

The general move: when a value has more than one spelling in a codebase, the
second comparison you write is the one that drifts. Find the existing
canonicalizer before adding another.

## Generalization

**When a join table carries an ordering column, it ranks one traversal
direction. Reading it from the other side is coincidence, not intent.** Before
sorting a reverse-direction relation list, ask what the column is _about_: if
it describes the row you are ranking _by_, it is a ranking; if it describes the
row you are ranking _from_, it is noise that happens to be stable. Rank on a
property of the entities being ordered.

The same shape is latent anywhere an edge attribute is read from both ends —
`order`, `weight`, `position`, `sequence` — and it is worth grepping for the
next time one is added to a bidirectional relation.

## Related

- `docs/solutions/logic-errors/canonical-video-relation-order-download-prefixes.md`
  — the sibling trap on the same column, in the correct direction: deriving a
  child's canonical position from a _filtered array index_ rather than from
  `VideoRelation.order`.
- `docs/plans/2026-06-14-001-fix-watch-video-relation-order-plan.md` — where the
  column and the shared comparator were introduced.
