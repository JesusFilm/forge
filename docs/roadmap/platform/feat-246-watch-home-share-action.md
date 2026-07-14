---
id: "feat-246"
title: "Watch video hero share action"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-video"
  - "sharing"
---

## Problem

The individual Watch video hero gives visitors a Watch Now action but no direct
way to share the current video.

## Entry Points - Read These First

1. `docs/plans/2026-07-14-001-fix-watch-video-hero-share-action-plan.md` -
   implementation plan and verification scope.
2. `apps/web/src/components/watch/HeroPlayer.tsx` - individual video hero
   action row.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - page-owned lazy modal
   state and share identity.
4. `apps/web/src/components/watch/ShareModal.tsx` - existing canonical share
   URL, social, embed, and dialog behavior.

## What To Build

1. Render a localized secondary text Share action beside Watch Now on
   individual Watch video-page heroes only.
2. Open the existing lazy Share modal through the video page's existing modal
   callbacks.
3. Keep contextual Watch navigation intact while Share uses canonical video
   URLs.

## Constraints

- Do not add a second share flow or new share providers.
- Do not render the action on the Watch home carousel or Mux-only promotional
  inserts.
- Do not load ShareModal in the initial hero bundle or create a second modal
  owner.
- Do not change Watch URL, canonical, or SEO ownership.

## Verification

- Focused video-hero and renderer tests cover callback forwarding, the text CTA,
  and removal after player chrome appears.
- `@forge/web` typecheck and lint pass.
- Desktop and mobile browser smoke verifies the action layout and Share modal.

## Plan

Implementation plan:
`docs/plans/2026-07-14-001-fix-watch-video-hero-share-action-plan.md`
