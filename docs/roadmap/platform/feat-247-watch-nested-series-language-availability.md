---
id: "feat-247"
title: "Watch nested-series language availability"
owner: "vlad"
priority: "P2"
status: "complete"
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "language-availability"
---

## Problem

`SeriesEpisodeCard` receives the selected language for its parent series. A
nested `SERIES` or `COLLECTION` can have a different direct-child language
set, so emitting its standalone URL with the parent's language may still be
rejected by the exact per-content route-manifest language index.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SeriesEpisodeCard.tsx` - emits standalone
   nested-series URLs.
2. `apps/web/src/lib/content.ts` - owns the server projection supplied to the
   series card grid.
3. `apps/admin/src/services/video.service.ts` - provides direct-child playable
   dub language aggregation.
4. `apps/admin/src/services/watch-route-manifest.service.ts` - defines the
   exact standalone content-language admission contract.

## What To Build

1. Project a compact, per-nested-series language availability signal to the
   card grid without restoring the full child-dub fan-out.
2. Prefer the parent-selected language when the nested series admits it;
   otherwise use a deterministic admitted fallback or render an unlinked card.
3. Add a regression where a parent language is absent from a nested series and
   verify the generated card URL is admitted by the content-language manifest.

## Constraints

- Preserve the existing manifest as the sole route-admission authority.
- Do not fetch or serialize every child's full dub list.
- Keep normal playable-child contextual routing unchanged.

## Review Evidence

- Code-review finding: `apps/web/src/components/watch/SeriesEpisodeCard.tsx:61`
  emits a standalone URL with `languageSlug` but `WatchChild` does not expose
  the nested collection's direct-child language set.
- `getChildDubLanguages` and `loadAudioLanguageSlugsByContent` both aggregate
  direct-child playable Dubs, confirming the two language sets can differ.
