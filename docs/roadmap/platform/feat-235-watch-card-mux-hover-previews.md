---
id: feat-235
title: Watch card Mux hover previews
owner: urim
priority: P2
status: complete
start_date: 2026-07-08
duration: 1
depends_on:
  - feat-221
blocks: []
tags:
  - web
  - mux
  - ui
---

## Problem

Non-home Watch cards and rails showed static thumbnails even when a public Mux
playback ID was available. Viewers needed motion previews on hover/focus across
cards, sections, and non-home carousels without changing the Watch home hero
carousel behavior.

## Entry Points - Read These First

1. `apps/web/src/components/watch/MuxHoverPreview.tsx` - shared lazy hover/focus
   animated preview layer.
2. `apps/web/src/lib/url.ts` - Mux thumbnail, hero poster, and animated preview
   URL builders.
3. `apps/web/src/components/search/VideoCard.tsx` - search result card opt-in.
4. `apps/web/src/components/watch/SeriesEpisodeCard.tsx` - series episode grid
   card opt-in.
5. `apps/web/src/components/watch/SiblingCarousel.tsx` - watch chapter carousel
   opt-in.
6. `apps/web/src/components/sections/VideoRecommendations.tsx` - scene
   recommendation card opt-in.
7. `apps/web/src/components/sections/MediaCollection.tsx` - media collection
   card opt-in.

## Grep These

- `resolveMuxAnimatedPreviewUrl`
- `MuxHoverPreview`
- `animated.webp`
- `muxPlaybackId`
- `playbackId`

## What Changed

- Added a bounded Mux animated WebP URL helper using
  `https://image.mux.com/{PLAYBACK_ID}/animated.webp?start=2&end=6&width=448&fps=8`.
- Added a reusable client preview layer that does not mount the image until the
  card is hovered or focused.
- Enabled previews for search video cards, media collection cards, series
  episode cards, scene recommendation cards, and the watch sibling/chapter
  carousel.
- Left the Watch home carousel untouched.

## Constraints

- Do not request animated previews before hover/focus.
- Do not render previews for non-Mux or missing playback IDs.
- Keep previews decorative (`alt=""`, `aria-hidden`) and preserve existing card
  accessible names.
- Keep the animated WebP request small enough for catalog hover use.
- Do not change Watch home carousel playback or takeover behavior.

## Verification

1. `DATABASE_URL='postgresql://user:pass@localhost:5432/forge' ADMIN_SESSION_SECRET='01234567890123456789012345678901' AUTH_ISSUER_URL='https://auth.example.test' AUTH_ADMIN_CLIENT_ID='admin-client' pnpm --filter @forge/admin schema:print`
2. `pnpm --filter @forge/admin-graphql generate`
3. `pnpm --filter @forge/admin exec vitest run src/graphql/types/blocks.test.ts src/graphql/schema.test.ts`
4. `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx src/components/watch/__tests__/MuxHoverPreview.test.tsx src/components/search/VideoCard.test.tsx src/components/sections/VideoRecommendations.test.tsx src/lib/content.test.ts`
5. `pnpm --filter @forge/web typecheck`
6. `pnpm --filter @forge/admin typecheck`
7. `pnpm --filter @forge/admin-graphql typecheck`
8. `pnpm --filter @forge/web lint`
9. `pnpm --filter @forge/admin lint`
