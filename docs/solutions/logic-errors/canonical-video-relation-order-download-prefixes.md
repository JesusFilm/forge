---
title: Preserve canonical VideoRelation order in download filenames
date: 2026-08-06
category: logic-errors
module: Watch downloads
problem_type: logic_error
component: service_object
symptoms:
  - "Download filename prefixes were renumbered after visibility filtering collapsed canonical order gaps."
  - "Children with a null VideoRelation.order received a numeric download prefix."
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - apps/admin Watch route snapshot
  - packages/admin-graphql
tags:
  - canonical-order
  - video-relation
  - download-filenames
  - watch-route
---

# Preserve canonical VideoRelation order in download filenames

## Problem

Watch download filenames need the child's canonical playback position. The
pre-fix implementation reviewed during FGE-66 derived that position from the
index of the current `children` array. Public Watch projections filter
unpublished and soft-deleted children, so that array is a view of the relation
graph rather than the ordering authority.

## Symptoms

- Canonical relation orders `1, 3` could become filename prefixes `01_, 02_`.
- A relation with `order: null` could receive a prefix from its array slot.
- If only position 3 remained visible, the old multi-item guard could remove the
  prefix even though the child still had a canonical ordered position.
- Skipping an unavailable collection episode could renumber later downloads.

## What Didn't Work

Sorting the filtered array did not restore hidden positions or distinguish an
unsequenced relation from an ordered child. The broken rule was equivalent to:

```ts
const index = parent.children.findIndex(
  (child) => child.documentId === videoDocumentId,
)
return index < 0 ? null : { position: index + 1, total: parent.children.length }
```

Deriving sequence after collection eligibility checks had the same flaw. It
made dub and download availability part of the playback-order contract.

## Solution

Carry `VideoRelation.order` as nullable relation metadata through every boundary:

1. The Admin Watch snapshot selects and returns `order` for root children and
   nested parent children (`apps/admin/src/services/video.service.ts:1483`,
   `apps/admin/src/services/video.service.ts:1521`).
2. `WatchRouteSnapshotChildRelation` exposes nullable `Int`, and the checked-in
   schema and generated client both expose that contract
   (`apps/admin/src/graphql/types/video.ts:1202`,
   `packages/admin-graphql/src/admin-graphql-env.d.ts:139`).
3. Web fragments request `order` beside `child`, and normalization preserves it
   on `WatchChild` (`apps/web/src/lib/fragments/watch-video.ts:73`,
   `apps/web/src/lib/content.ts:149`, `apps/web/src/lib/content.ts:789`).
4. Series collection downloads forward the same value through
   `CollectionDownloadEpisode` instead of reconstructing it from the rendered
   episode index (`apps/web/src/components/watch/SeriesPageClient.tsx:451`,
   `apps/web/src/components/watch/collection-download-options.ts:14`).

Resolve a sequence only from a positive integer relation order. Use the largest
positive projected order for padding width:

```ts
const position = child?.order
if (!Number.isInteger(position) || position == null || position <= 0) {
  return null
}
const total = parent.children.reduce(maxPositiveOrder, position)
return { position, total }
```

The current resolver implements this rule in
`apps/web/src/components/watch/download-link.ts:133`. It does not require two
visible children. A single visible relation with `order: 3` remains `03_`, while
a true standalone video has no ordered parent and remains unprefixed.

Collection options resolve sequence against the full episode relation projection
before moving unavailable episodes into `skipped`
(`apps/web/src/components/watch/collection-download-options.ts:71`). Direct,
modal, and collection paths then share the same filename builder.

The filename builder also reserves the fixed sequence, language-code, rendition,
and extension fields. It trims the flexible title and display-language fields
first, so adding a prefix cannot corrupt `_eng_360p.mp4`
(`apps/web/src/components/watch/download-link.ts:154`).

## Why This Works

Filtering, deduplication, localization fallback, and download availability no
longer redefine sequence. A projected set with orders `1, 3, null` produces
`01_`, `03_`, and no prefix. If only order 3 is visible, its canonical position
still survives. Padding expands from the maximum positive relation order rather
than the number of visible children.

## Prevention

- Never infer persistent business order from an array index when the source
  model has an order field. Permission-scoped and filtered arrays are views.
- When order lives on a join row, project it through service DTOs, GraphQL
  schema and generated clients, fragments, normalizers, and component props.
- Test relation orders `1, 3, null`, a single visible ordered relation, a skipped
  downloadable child, and a parentless standalone video
  (`apps/web/src/components/watch/__tests__/download-link.test.ts:208`,
  `apps/web/src/components/watch/__tests__/download-link.test.ts:218`,
  `apps/web/src/components/watch/__tests__/download-link.test.ts:227`,
  `apps/web/src/components/watch/collection-download-options.test.ts:135`).
- Test the filename length boundary with both the prefix and fixed identity
  suffix present (`apps/web/src/components/watch/__tests__/download-link.test.ts:152`).
- Keep direct and modal sequence propagation under a component-boundary test
  (`apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx:343`).

## Related Issues

- [FGE-66](https://linear.app/jesus-film-project/issue/FGE-66/prefix-segmented-video-download-filenames-with-playback-order)
- [Watch download sequence prefixes](../../roadmap/topic-experiences/feat-338-watch-download-sequence-prefixes.md)
- [Admin VideoRelation order](../../roadmap/platform/feat-190-admin-video-relation-order.md)
- [Prisma VideoRelation back-reference semantics](../database-issues/prisma-video-relation-inverted-back-references-20260514.md)
