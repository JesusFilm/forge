---
id: "feat-264"
title: "Watch download modal poster resolution"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
---

## Problem

The Watch download modal stretched a Cloudflare poster derivative fixed at
`120x68` across a full-width, high-density mobile viewport even though the
selected Dub had a Mux playback ID. The browser upscaled that tiny source,
making the image look blurred beside sharp modal text and controls.

## Entry Points — Read These First

1. `apps/web/src/lib/url.ts` - shared Watch poster and Mux image URL helpers
2. `apps/web/src/components/watch/WatchPageClient.tsx` - selected Dub poster resolution and modal props
3. `apps/web/src/components/watch/DownloadModal.tsx` - responsive poster rendering
4. `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx` - download modal prop integration coverage

## Grep These

- `resolveMuxFrameThumbnailUrl`
- `resolvePosterUrl`
- `watch-download-modal-poster`
- `posterUrl={posterUrl}`

## What To Build

1. Add a download-modal-specific poster resolver that requests a bounded,
   high-resolution Mux frame for the selected Dub.
2. When Mux is unavailable, enlarge dimensioned Cloudflare editorial
   derivatives while leaving other providers unchanged.
3. Pass the new source only to `DownloadModal` so hero, card, carousel, and
   Share modal image behavior is unchanged.
4. Add helper and integration tests that lock the source URL and fallback.

## Constraints

- Do not increase the shared 448-pixel card thumbnail recipe.
- Do not alter download APIs, account gating, Terms of Use, or modal layout.
- Do not add CSS sharpening filters or client-side image loaders.

## Verification

- `pnpm --filter @forge/web test -- src/lib/url.test.ts src/components/watch/__tests__/WatchPageClient.download.test.tsx src/components/watch/__tests__/DownloadModal.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Mobile-width browser smoke on the affected Watch download modal with screenshot proof

## Completion Evidence

- Focused tests: 44 passing across the resolver, Watch client integration, and
  download modal suites.
- `pnpm --filter @forge/web typecheck` and `pnpm --filter @forge/web lint` pass.
- Mobile browser smoke at 390px on
  `/watch/new-believer-course.html/1-the-simple-gospel/english.html` requests the
  `1280x720` Mux source and selects an `828w` responsive candidate with no
  browser console errors.
- Screenshot: `output/playwright/watch-simple-gospel-download-modal-fixed-mobile.png`.
