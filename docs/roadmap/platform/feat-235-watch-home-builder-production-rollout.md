---
id: feat-235
title: Watch home builder production rollout
owner: urim
priority: P1
status: planned
start_date: 2026-07-06
duration: 1
depends_on:
  - feat-160
blocks: []
tags:
  - platform
  - web
  - admin
  - watch
  - release
---

## Problem

The code path can render the Watch homepage body from a published homepage
Experience, but production will keep showing only the static hero shell until
the canonical `watch-home` Experience is created or published in the production
Admin data store and the web cache is refreshed.

## Entry Points - Read These First

1. `apps/admin/src/scripts/seed-watch-homepage-experience.ts` - local/staging
   seed shape and the canonical block/item payload.
2. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` - static-hero shell logic
   when the builder homepage is absent.
3. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - static hero,
   builder blocks, and static promo/footer composition.
4. `apps/web/src/components/sections/MediaCollection.tsx` - Watch-home styled
   media collection renderer.

## What To Do

1. Create or publish the production Admin homepage Experience for locale `en`
   with slug `watch-home`, `isHomepage: true`, and the canonical blocks from the
   seed script.
2. Confirm every manual media item includes both `videoId` and `videoSlug` so
   cards link to `/watch/{slug}.html/english.html`.
3. Confirm the BibleProject Advent and Scripture sections use the
   `collection` variant, while the main Gospel rail uses `carousel` and the
   other rows use `grid`.
4. Revalidate or redeploy the public web cache after the production data is
   published.
5. Smoke `/watch` in production: static hero still renders, builder body rows
   render above the static promo/footer, hover backdrops update, and cards
   navigate.

## Constraints

- Do not run the local seed script directly against production without an
  approved production data path. The script intentionally refuses obvious
  production hosts.
- Keep the top hero and footer static for this rollout.
- If production data cannot be authored through Admin UI, use an auditable
  production migration/runbook rather than an ad hoc database edit.

## Verification

1. Production Admin GraphQL returns a homepage Experience whose first block is
   `WatchHomeHeroBlock` and whose following blocks are `MediaCollectionBlock`.
2. At least one manual item from each media collection has a non-empty
   `videoSlug` in GraphQL.
3. Public `/watch` renders the builder-authored body, not only the fallback
   static sections.
4. A card click from each variant lands on the expected watch video URL.
