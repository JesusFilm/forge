---
id: "feat-655"
title: "Crop Watch landscape stills safely for portrait surfaces"
owner: "vlad"
priority: "P2"
status: "in-progress"
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

- Keep curated authored artwork first on vertical media cards; use portrait `fit_mode=smartcrop` Mux derivatives when artwork is absent and a playback ID is available.
- Keep the full-viewport hero on the existing warmed 1280px landscape derivative for every viewport.
- Use the shared 448x252 frame derivative for circular timeline thumbnails.
- Retain existing authored-image fallbacks when no Mux playback ID is available.

## Verification

- Assert the full-viewport hero keeps using the warmed 1280px Mux derivative.
- Assert vertical cards use the 2:3 Mux crop when artwork is absent, keep authored artwork when present, and circular thumbnails use the shared frame resolver on the live pool conversion.
- Run focused Watch Home, MediaCollection, URL tests, Web typecheck, lint, and formatting.

## Completion Evidence

- Portrait hero derivatives were measured against a public Mux playback ID on 2026-10-08. The 1280x2276 smartcrop returned 213,450 bytes in 1.728s; the 720x1280 variant returned 95,543 bytes in 1.135s. The existing 1280px landscape derivative returned 78,226 bytes in 0.114s. Since the hero is above the fold and the custom crops are cold on-demand renders, the implementation retains the warmed hero derivative and applies portrait smartcrop only to lazy vertical cards.
- Implemented 448x672 smartcrop for vertical Mux cards and reused the warmed 448x252 derivative for circular timeline thumbnails.
- Focused tests: 137 passed across four files; Web typecheck passed; targeted ESLint and Prettier passed.
