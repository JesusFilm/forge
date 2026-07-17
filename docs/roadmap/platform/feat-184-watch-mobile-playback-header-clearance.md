---
id: "feat-184"
title: "Watch Mobile Playback Header Clearance"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-07-16"
duration: 1
depends_on:
  - "feat-175"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mobile"
  - "video"
  - "responsive-layout"
---

## Problem

The default Watch hero reserves a black band for the floating header during
the mobile portrait muted preview, then removes that clearance when playback
controls appear. The active video moves underneath the fixed logo, search,
and language controls in iPhone Safari. The clearance also needs to account
for devices that report a non-zero top safe-area inset.

## Entry Points - Read These First

1. `docs/plans/2026-07-16-001-fix-watch-mobile-header-video-overlap-plan.md`
   - implementation plan and screenshot-derived acceptance contract.
2. `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`
   - predecessor that introduced the preview-only header band.
3. `apps/web/src/components/watch/HeroPlayer.tsx`
   - mobile portrait preview predicate, header band, media frame, and sticky
     wrapper geometry.
4. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
   - focused preview, playback reveal, autoplay, and custom-overlay coverage.
5. `apps/web/src/components/FloatingSearchProvider.tsx`
   - established `6rem + safe-area inset` floating-header geometry.

## What To Build

1. Keep the default Watch mobile portrait header band present during muted
   preview and committed playback.
2. Size the band to 96px plus `env(safe-area-inset-top, 0px)` so it clears the
   same boundary used by the floating header.
3. Keep the muted preview square, but render committed playback as a 16:9
   media frame below the persistent band.
4. Keep desktop, tablet, mobile landscape/fullscreen, custom-overlay hero,
   player-control, subtitle, and language-switch behavior unchanged.

## Verification

- Focused HeroPlayer tests cover preview, click-to-playback, autoplay, and
  custom-overlay state boundaries.
- Browser smoke at an iPhone portrait viewport proves the active media-frame
  top is at or below the floating header bottom, with no horizontal overflow
  or console errors.

## Plan

Implementation plan:
`docs/plans/2026-07-16-001-fix-watch-mobile-header-video-overlap-plan.md`
