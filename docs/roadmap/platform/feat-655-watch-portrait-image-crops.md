---
id: "feat-655"
title: "Validate Watch portrait artwork cropping and remove cold thumbnail recipes"
owner: "vlad"
priority: "P2"
status: "blocked"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - web
  - watch-page
  - performance
---

## Problem

Vertical media cards place landscape or undersized stills in portrait frames. The resulting crops lose most of the image and upscale low-resolution sources; the circular home timeline also requests a bespoke oversized thumbnail.

## Entry Points

- `apps/web/src/lib/url.ts`
- `apps/web/src/components/home/WatchHomeTvCarousel.tsx`
- `apps/web/src/components/sections/MediaCollection.tsx`

## What To Build

- Keep curated authored artwork first. Reuse the admin-pinned `WATCH_CHAPTER_CAROUSEL_RECIPE` 448x252 fallback when artwork is absent; do not create a cold 448x672 variant.
- Keep the full-viewport hero on the existing warmed 1280px landscape derivative for every viewport.
- Keep circular timeline thumbnails authored-first and use the shared 448x252 frame only when art is absent.
- Retain existing authored-image fallbacks when no Mux playback ID is available.

## Verification

- Assert the full-viewport hero keeps using the warmed 1280px Mux derivative.
- Assert vertical route-derived cards use the pinned 448x252 frame when artwork is absent, keep authored artwork when present, and circular thumbnails keep authored priority on the live pool conversion.
- Run focused Watch Home, MediaCollection, URL tests, Web typecheck, lint, and formatting.

## Original October 8 Evidence (Superseded by Revalidation)

- Portrait hero derivatives were measured against a public Mux playback ID on 2026-10-08. The 1280x2276 smartcrop returned 213,450 bytes in 1.728s; the 720x1280 variant returned 95,543 bytes in 1.135s. The existing 1280px landscape derivative returned 78,226 bytes in 0.114s. Since the hero is above the fold and the custom crops are cold on-demand renders, the implementation retains the warmed hero derivative and applies portrait smartcrop only to lazy vertical cards.
- Implemented 448x672 smartcrop for vertical Mux cards and reused the warmed 448x252 derivative for circular timeline thumbnails.
- Focused tests: 137 passed across four files; Web typecheck passed; targeted ESLint and Prettier passed.

## October 9 Revalidation and Remaining Blocker

Production browser evidence confirms seven authored 1280x600 landscape stills
inside 180x270 portrait cards in “Meet Jesus Through Stories from Around the
World”. Cover shows roughly 31% of the source width. The original PR only added a
fallback for missing artwork, so it did not resolve this observed defect.

The 448x672 derivative has been removed in favor of the existing admin recipe.
Timeline artwork priority now matches PR #2630: authored image, pinned frame,
then existing poster fallback. This reconciles intent only; #2630 remains a
separate branch and its textual merge conflict still requires integration.

The actual authored-image crop remains blocked on a presentation decision:
contain preserves all source pixels but turns the landscape image into a band
covering about 31% of the portrait frame height, while the current hover preview
still cover-fills. The existing design guidance explicitly treats letterboxed
slivers as a failure. Choose contain with an intentional fill treatment, or
provide portrait artwork/change the authored rail orientation. Do not silently
replace curated artwork with a video frame. Core video-image width/height are
not populated; implementing contain needs a selected-image aspect hint or
browser natural-dimension classification. No editorial content has been changed.

The old hero reference is stale: the active TV carousel already uses the warmed
1280px Mux poster. This correction preserves that path. The legacy bare-Mux
fallback inside `enrichMediaItem` predates this PR; it means the newly-added
portrait fallback was mostly unreachable for Experience items. Changing that
shared enrichment contract is separate from claiming this crop is fixed.

## Correction Verification

- Focused URL, Watch Home, hero, and MediaCollection tests: 154 passed (78 across four focused files plus 76 WatchHomePage tests).
- Web typecheck and targeted ESLint passed under Node 24.
- Public Mux sample: removed 448x672 URL returned 32,187 bytes at 89ms TTFB;
  pinned 448x252 returned 16,169 bytes at 90ms. Both were already warm in this
  recheck; the earlier independent cold-hit evidence remains the reason to
  reuse the admin recipe, rather than infer cold behavior from these warm hits.
- A bounded browser fixture using the actual downloaded provider bytes confirmed
  640x300 authored art in a 180x270 cover box still exposes 31.25% of its width
  before and after. This deliberately proves the crop remains unresolved.
  Fallback payload fell by 16,018 bytes with no added request or layout change.
  This is image/resource evidence, not a full production Web Vitals claim.
