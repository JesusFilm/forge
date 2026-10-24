---
id: "feat-301"
title: "Watch public share origin"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "share"
---

## Problem

The Watch Share modal uses `NEXT_PUBLIC_CANONICAL_ORIGIN` for Copy Link. Local
development therefore produces `http://localhost:3000/watch/...`, disables the
Facebook and X controls, and says sharing only works after deployment instead
of providing the public Watch destination.

## Entry Points - Read These First

1. `apps/web/src/components/watch/ShareModal.tsx` - Copy Link, social intents,
   and the local-origin warning.
2. `apps/web/src/components/watch/WatchPageClient.tsx` - page-owned Share modal
   and non-modal Share fallback.
3. `apps/web/src/components/watch/SeriesPageClient.tsx` - series Share language
   identity.
4. `apps/web/src/components/sections/BibleQuotesCarousel.tsx` - native and
   clipboard Share outside the modal.
5. `apps/web/src/lib/share.ts` - client-safe Share URL builders.
6. `apps/web/src/lib/routes.ts` - public Watch origin and route shapes.

## What To Build

1. Resolve Share URLs through one client-safe helper.
2. Fall back to `https://www.jesusfilm.org` for literal local or private app
   origins while preserving configured public origins.
3. Keep Facebook and X enabled locally and use the same URL shown by Copy Link.
4. Pass the resolved public audio-language slug from series pages.
5. Define and test the unavailable state for invalid video or language slugs.
6. Route Bible-quotes Share through the same public standalone URL policy.

The shared contract is
`ResolveWatchShareUrlInput -> string | null`: invalid content identity returns
`null`; valid video identity returns an absolute standalone public Watch URL.

## Grep These

- `rg -n "ShareModal|buildShareFallbackHref|handleShare" apps/web/src/components`
- `rg -n "resolveWatchShareUrl|normalizePublicShareableOrigin" apps/web/src`
- `rg -n "watchVideoPath|parseWatchPath|WATCH_PUBLIC_METADATA_ORIGIN" apps/web/src/lib`

## Constraints

- Keep the standalone `/watch/{video}.html/{language}.html` Share identity.
- Do not change contextual collection navigation or public Watch route shapes.
- Keep ShareModal lazily loaded and page-owned.
- Do not change embed behavior, add providers, or add locale-catalog strings.

## Verification

```bash
pnpm --filter @forge/web test -- \
  src/lib/share.test.ts \
  src/components/sections/BibleQuotesCarousel.test.tsx \
  src/components/watch/__tests__/ShareModal.test.tsx \
  src/components/watch/__tests__/SeriesPageClient.test.tsx \
  src/components/watch/__tests__/WatchPageClient.navigation.test.tsx \
  src/lib/routes.test.ts
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

Run `ce-test-browser mode:pipeline` against local standalone, contextual, and
series routes. Confirm the public Share URL, enabled social controls, absent
deployment warning, resolved public language slug, and unchanged page URL
after closing.
