---
id: feat-214
title: Improve Watch single-video Lighthouse first-load JS
status: in-progress
lane: platform
depends_on:
  - feat-178
  - feat-213
blocks: []
---

## Problem

Production Lighthouse for
`https://watch.jesusfilm.org/watch/jesus.html/english.html` showed the Watch
single-video page still spending too much browser time on first-load JavaScript:
performance score 63, LCP 7.9s, TBT 390ms, TTI 12.7s, and roughly 366 KiB of
unused JavaScript. The server/API work is necessary, but the browser trace
shows a separate client-loading problem after the page HTML arrives.

## Scope

- Keep the Watch route, Admin GraphQL schema, and rendered page functionality
  unchanged.
- Prevent server resolver modules from entering Watch client chunks through
  small shared helpers.
- Avoid loading user-triggered modal/search chunks during the Lighthouse
  first-load window; keep on-demand loading on actual user intent.
- Re-run targeted Watch client tests and production Lighthouse after deploy.

## Verification

1. `pnpm --filter @forge/web test -- WatchPageClient.download WatchPageClient.navigation watch-interaction-loader content-watch-merge`
2. `pnpm --filter @forge/web exec eslint src/components/watch/WatchPageClient.tsx src/components/watch/WatchSectionRenderer.tsx src/lib/watch-blocks.ts src/lib/content.ts src/components/watch/__tests__/WatchPageClient.download.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
3. Production Lighthouse for
   `https://watch.jesusfilm.org/watch/jesus.html/english.html`, comparing score,
   LCP, TBT, TTI, unused JS, and transfer size against the baseline above.
