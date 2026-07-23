---
title: "Web video thumbnails use one shared white interaction frame"
date: "2026-07-21"
category: "design-patterns"
module: "apps/web"
problem_type: "design_system"
component: "VideoThumbnailInteractionFrame"
severity: "medium"
applies_when:
  - "Adding or changing an interactive video thumbnail in apps/web"
  - "Choosing hover and keyboard-focus styling for video cards"
  - "Migrating a thumbnail away from a local red, amber, or native outline"
tags:
  - "web"
  - "video-thumbnail"
  - "focus-visible"
  - "hover"
  - "design-system"
  - "accessibility"
related_components:
  - "apps/web/src/components/ui/video-thumbnail-interaction-frame.tsx"
  - "apps/web/src/components/home/WatchHomeCard.tsx"
  - "apps/web/src/components/search/VideoCard.tsx"
  - "apps/web/src/components/sections/CarouselVideo.tsx"
  - "apps/web/src/components/watch/SeriesEpisodeCard.tsx"
---

# Web video thumbnails use one shared white interaction frame

## Context

Web video cards accumulated several interaction indicators: a red gradient on
Watch home and search, local white borders on Experience/chapter cards, amber
episode rings, and native focus outlines layered on top. The result varied by
route and sometimes rendered two simultaneous keyboard-focus indicators.

## Standard

Every interactive video thumbnail uses
`VideoThumbnailInteractionFrame` and adds
`VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS` to its focusable root.

The shared frame is:

- an inset 4px solid-white border;
- rounded from the thumbnail parent's inherited radius;
- above preview, copy, progress, and bevel layers at `z-[80]`;
- revealed identically by `group-hover` and `group-focus-visible`;
- free of red/amber color, gradients, and shadows.

When a card has metadata outside its image, place the frame inside the relative
thumbnail container. When the image, scrim, and copy form one thumbnail card,
place it at the card root. Keep `group` on the focusable ancestor.

## Stateful cards

Use `interactive={false}` when an active card should not reveal the interaction
frame, and `visible` for an explicit pending/selected state that needs the same
frame. Preserve a separate active indicator when the surface already has one.
If inactive cards reduce parent opacity, add the matching `focus-visible`
opacity treatment used for hover so keyboard focus does not dim the frame.

## Exclusions

This contract applies to interactive video thumbnails, not every image. Static
hero posters, embedded players, modal previews, Bible quote imagery, search
category tiles, and section-navigation artwork keep their own appropriate focus
or presentation treatments.

## Verification

The shared component test locks geometry and hover/focus parity. Consumer tests
should assert the shared frame at stateful or unusually layered sites and prove
that unroutable fallback cards do not advertise interaction. Repository search
should find no
`watch-home-gradient-outline` use and no `search-card-red-outline` use by video
cards.
