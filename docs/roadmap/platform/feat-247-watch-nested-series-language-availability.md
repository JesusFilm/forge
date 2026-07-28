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

FGE-47 correctly stopped a language-less English Watch URL from silently
falling back to Afrikaans, but a navigational parent can expose English only
through a directly nested `SERIES` or `COLLECTION`.

The proxy rejects that public parent URL before the page can render, and a
page-only language fallback can still give nested cards or a trailer the wrong
language.

## Entry Points - Read These First

1. `apps/admin/src/services/watch-route-manifest.service.ts` - publishes the
   compact admission snapshot.
2. `apps/web/src/proxy.ts` - admits public Watch URLs before page rendering.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - resolves the
   parent language inventory and visible nested cards.
4. `apps/web/src/components/watch/SeriesPageClient.tsx` - consumes the
   server-selected parent language for cards and controls.

## What To Build

1. Add a compact direct parent-to-nested-container language relation to the
   route manifest, generated only from published nested collections and series.
2. Admit canonical and explicit English parent URLs when that relation proves
   an English nested route; retain 404 behavior when it proves none.
3. Merge exactly admitted nested languages into the parent client inventory,
   hide unavailable nested cards, and suppress a mismatched trailer variant.
4. Cover Admin manifest generation, proxy admission, server page rendering,
   and client card-language propagation with focused tests.

## Constraints

- Preserve the existing manifest as the sole route-admission authority.
- Do not fetch or serialize every child's full dub list.
- Keep normal playable-child contextual routing unchanged.
- Do not silently redirect an English parent or nested card to Afrikaans.

## Review Evidence

- Production verification of FGE-47 showed `/watch/discipleship.html` as a
  404 while its nested English collection remained available.
- `apps/web/src/proxy.ts` applies route-manifest admission before the parent
  page's `childDubLanguages` resolution runs.
- Release sequencing: deploy Admin first, refresh the route-manifest snapshot,
  and verify `nestedContainerAudioLanguageIndexesByParent` is present before
  deploying Web. Pre-feature snapshots intentionally fail closed because their
  episode pairs cannot distinguish a nested collection from a leaf episode.
