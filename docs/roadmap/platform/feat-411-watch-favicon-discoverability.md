---
id: "feat-411"
title: "Watch favicon discoverability"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "seo"
---

## Problem

The Watch app declares files with `.png` names and `image/png` metadata even
though their encoded format is WebP, and it advertises a 180x180 image as
192x192. Favicon and link-preview consumers can reject those mismatched assets
or fall back to the legacy domain-root 16x16 icon.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - production Watch icon
   metadata.
2. `apps/web/src/app/(demo)/layout.tsx` - demo icon metadata.
3. `apps/web/public/images/jesusfilm-sign.svg` - canonical source mark.
4. `apps/web/public/images/favicon-*.png` - generated raster icon assets.

## Grep These

- `favicon-32.png`
- `favicon-180.png`
- `Metadata`
- `icons:`
- `manifest`

## What To Build

1. Encode every `.png` favicon asset as a real PNG with dimensions matching
   its filename and metadata.
2. Add 192x192 and 512x512 manifest icons and a standards-compliant web app
   manifest served under the `/watch` base path.
3. Add a multi-resolution 16x16, 32x32, and 48x48 ICO fallback for the Watch
   app.
4. Keep production and demo layouts aligned through one shared metadata
   definition.
5. Add focused tests for icon files, sizes, formats, metadata, and manifest
   references.

## Constraints

- Preserve the existing Jesus Film sign artwork and dark theme.
- Do not change rendering, hydration, routing, or data fetching.
- Do not claim to replace `https://www.jesusfilm.org/favicon.ico`; the root
  domain asset is owned outside this base-path app.
- Do not add runtime dependencies or client JavaScript.

## Verification

- Run focused Web favicon metadata and asset tests.
- Run Web TypeScript validation and changed-file formatting.
- Build the Web app and confirm generated HTML advertises accurate icon and
  manifest URLs.
- Confirm the change adds no page JavaScript, requests no dynamic data, and
  does not alter the Watch render path.
