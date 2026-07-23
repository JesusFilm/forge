---
id: "feat-301"
title: "Watch public share origin"
owner: "vlad"
priority: "P1"
status: "in-progress"
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

## Constraints

- Keep the standalone `/watch/{video}.html/{language}.html` Share identity.
- Do not change contextual collection navigation or public Watch route shapes.
- Keep ShareModal lazily loaded and page-owned.
- Do not change embed behavior, add providers, or add locale-catalog strings.

## Verification

- Focused Share helper, modal, page-client, series-client, route, and metadata
  tests pass.
- Web typecheck and lint pass.
- Browser smoke from local standalone, contextual, and series routes confirms
  the public Share URL, enabled social controls, absent deployment warning,
  resolved public language slug, and unchanged page URL after closing.
