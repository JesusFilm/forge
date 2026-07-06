---
id: feat-160
title: Watch home carousel admin data parity
owner: urim
priority: medium
status: "complete"
start_date: "2026-06-05"
duration: "3d"
depends_on:
  - feat-159
blocks:
  - feat-235
tags:
  - web
  - watch
  - admin-graphql
  - editorial
---

# Watch home carousel admin data parity

## Problem

`feat-159` ports the beta watch home carousel with a Forge-owned static playlist/insert config and admin-backed video data. Several upstream sources still have no admin-owned equivalent, so follow-up PRs should move those editorial decisions into admin and close the remaining design/data parity gaps.

## Missing Data And Follow-Up Work

- Admin-owned watch home playlist ordering, collection groups, blacklist, and per-language fallbacks.
- Admin-owned Mux insert records, including playback IDs, trigger rules, action links, logo flags, overlay labels, and descriptions.
- Conditional insert overlays for time-of-day copy from the upstream Mux insert config.
- Local thumbnail/poster override parity for upstream watch carousel cards.
- Blurhash or dominant-color placeholders for cards while images load.
- Collection count and pool endpoints so the carousel can preserve upstream daily/random selection without broad overfetch.
- Bounded admin carousel pool query so upstream playlist-only sources can load without the current broad `watchHomeVideos` child/dub payload timing out.
- Full admin-backed below-the-fold `CollectionsRail` parity.
- Stronger language fallback rules when an active language has too few playable videos.

## Starting Points

- Implementation plan: `docs/plans/2026-06-05-002-feat-watch-home-carousel-sequence-parity-plan.md`
- Static Forge config from `feat-159`: `apps/web/src/lib/watch-home-config.ts`
- Resolver gap reporting from `feat-159`: `apps/web/src/lib/watch-home.ts`
- Admin video service filters: `apps/admin/src/services/video.service.ts`
- Admin experience editor patterns: `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`

## Verification

- Admin can configure the carousel without code changes.
- Web renders the same first viewport from admin-owned playlist/insert records.
- Existing static config can be removed or reduced to migration fallback data.
- Mobile and desktop visual smoke still pass for `/watch` and localized home routes.
