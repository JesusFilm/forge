---
id: "feat-338"
title: "Watch download sequence prefixes"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-06"
duration: 1
depends_on:
  - "feat-196"
blocks: []
tags:
  - "web"
  - "watch"
  - "download"
  - "ux"
---

## Problem

Downloaded Watch segments use descriptive filenames but omit their canonical
position within the parent film or series. Devices that play a folder in
alphabetical order therefore play segment titles out of sequence, forcing field
teams to rename every file manually.

Customer evidence: [Linear FGE-66](https://linear.app/jesus-film-project/issue/FGE-66/prefix-segmented-video-download-filenames-with-playback-order), sourced from Help Scout conversation 1653286.

## Entry Points - Read These First

1. `apps/web/src/components/watch/download-link.ts` - compatible filename builder.
2. `apps/web/src/components/watch/WatchPageClient.tsx` - single-video download URL construction.
3. `apps/web/src/components/watch/collection-download-options.ts` - ordered collection queue filename construction.
4. `apps/web/src/lib/fragments/watch-video.ts` - ordered parent/child relation projection.
5. `apps/web/src/lib/content.ts` - flattened Watch parent and child relation models.

## Grep These

- `buildDownloadFilename`
- `buildCollectionDownloadQueue`
- `VideoRelation.order`
- `parents {`
- `children {`

## What To Build

1. Prefix ordered segment and episode filenames with their one-based canonical
   relation position, for example `01_Birth-of-Jesus_English_eng_240p.mp4`.
2. Apply the same convention to individual Watch downloads and collection
   download queue items.
3. Use at least two digits and expand the width for sequences longer than 99
   items.
4. Preserve gaps when some collection children are not downloadable instead of
   renumbering the remaining files.
5. Preserve the existing title, language, ISO code, rendition, extension,
   sanitization, length, proxy, and authentication contracts.
6. Leave standalone downloads without an ordered parent position unchanged.

## Constraints

- Do not expose raw CDN URLs or weaken `/watch/api/download` validation.
- Do not infer order alphabetically from titles or slugs.
- Do not hand-edit generated GraphQL environment types.
- Do not change public Watch route shapes or collection transfer concurrency.

## Verification

- Focused filename helper tests cover padded positions, 100+ item widths,
  invalid/missing positions, and the 200-character limit.
- Watch page tests prove ordered segment downloads receive a prefix while
  standalone downloads retain the compatible filename.
- Collection queue tests prove canonical prefixes survive skipped children and
  remain unique.
- Run focused Web tests, Web typecheck, lint, and the roadmap README generator.
