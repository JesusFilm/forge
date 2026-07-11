---
id: "feat-246"
title: "Watch home share action"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-07-10"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-home"
  - "sharing"
---

## Problem

The Watch home hero gives visitors a Watch Now action but no direct way to
share the active catalog video.

## Entry Points - Read These First

1. `docs/plans/2026-07-10-001-feat-watch-home-share-action-plan.md` -
   implementation plan and verification scope.
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - active hero action
   row and modal ownership.
3. `apps/web/src/lib/watch-home.ts` - catalog video normalization and canonical
   share identity.
4. `apps/web/src/components/watch/ShareModal.tsx` - existing canonical share
   URL, social, embed, and dialog behavior.

## What To Build

1. Render a localized secondary Share action beside Watch Now for shareable
   catalog-video hero slides.
2. Open the existing lazy Share modal with canonical standalone video identity
   and active-slide metadata.
3. Keep contextual Watch navigation intact while Share uses canonical video
   URLs.
4. Lock carousel interaction and preview playback behind the open Share modal.

## Constraints

- Do not add a second share flow or new share providers.
- Do not render a catalog-video share action for Mux-only promotional inserts.
- Do not load ShareModal in the initial hero bundle.
- Do not change Watch URL, canonical, or SEO ownership.

## Verification

- Focused Watch-home and home-model tests cover identity, CTA, modal lifecycle,
  interaction lock, and preview pause/resume behavior.
- `@forge/web` typecheck and lint pass.
- Desktop and mobile browser smoke verifies the action layout and Share modal.

## Plan

Implementation plan:
`docs/plans/2026-07-10-001-feat-watch-home-share-action-plan.md`
