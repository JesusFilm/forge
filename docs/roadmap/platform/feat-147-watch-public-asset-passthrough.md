---
id: "feat-147"
title: "Watch Public Asset Passthrough"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-29"
duration: 1
depends_on: []
blocks: []
tags:
  - platform
  - web
  - watch-page
  - routing
---

## Problem

The `/watch` proxy canonicalizer treats public asset paths such as
`/watch/images/jesusfilm-sign.svg` as watch content routes and redirects them
to `.html` content-shaped URLs. That returns HTML where the browser expects an
image, breaking the floating JesusFilm sign and putting flags, favicons,
overlays, and public fonts at the same risk.

## Entry Points - Read These First

1. `apps/web/src/lib/url-shape.ts` - shared reserved-prefix contract.
2. `apps/web/src/lib/routes.ts` - `parseWatchPath` route classification.
3. `apps/web/src/lib/url-canonicalize.ts` - pure watch URL canonicalizer.
4. `apps/web/src/proxy.ts` - Next proxy matcher and redirect pipeline.
5. `apps/web/src/lib/watch-url-probe.ts` - production/preview URL probe matrix.
6. `apps/web/public/` - first-level public asset directories that must pass
   through under the `/watch` basePath.

## Grep These

- `RESERVED_PREFIXES`
- `5.7 asset/framework subtrees`
- `/watch/images`
- `/watch/fonts`
- `assets|favicon\\.ico|robots`

## What To Build

- Reserve every current first-level public asset directory under
  `apps/web/public`: `assets`, `images`, and `fonts`.
- Keep route parsing, pure canonicalization, and proxy matcher exclusions in
  sync for those reserved public asset subtrees.
- Extend the watch URL probe matrix with representative paths for the logo,
  flags, overlay asset, and a public font.
- Make pass-through probe expectations fail when either side redirects or
  changes the final path, even if production and preview match each other.

## Constraints

- Do not move, duplicate, or rename public assets.
- Do not replace valid `/watch/images/...` component paths with unrelated CDN
  paths.
- Do not add request-time filesystem reads or dynamic public-directory scans.
- Do not alter watch content canonical URL shapes.
- Do not add Cloudflare or Railway routing rules for an app proxy contract bug.

## Verification

- `pnpm --filter @forge/web test -- src/lib/url-shape.test.ts src/lib/routes.test.ts src/lib/url-canonicalize.test.ts src/proxy.test.ts src/lib/watch-url-probe.test.ts src/components/__tests__/FloatingSearchProvider.test.tsx src/components/watch/__tests__/LanguageCombobox.test.tsx src/components/watch/__tests__/WatchSectionRenderer.test.tsx src/lib/media-image-url.test.ts`
- Confirm `/watch/images/*`, `/watch/assets/*`, and `/watch/fonts/*` do not
  redirect to `.html` content paths.
- Confirm existing watch content redirects such as `/jesus` and
  `/jesus.html/chinese-mandarin.html` remain unchanged.
