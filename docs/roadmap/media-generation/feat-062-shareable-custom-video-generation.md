---
id: "feat-062"
title: "Shareable Custom Video Generation"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-09-01"
duration: 30
depends_on:
  - "feat-056"
  - "feat-057"
blocks: []
tags:
  - "generation"
  - "sharing"
  - "shared"
---

## Problem

This is shared work between Vlad and Tatai. Generated videos become much more valuable if the result can be packaged, linked, and shared cleanly instead of living only as an internal artifact. We need a custom-generation path that ends with a shareable experience.

## Entry Points — Read These First

1. `docs/roadmap/media-generation/feat-056-ai-video-template-system.md` — generation input system
2. `docs/roadmap/media-generation/feat-057-automated-video-rendering-engine.md` — render execution layer
3. `apps/manager/src/services/storage.ts` — output artifact storage
4. `apps/web/src/app/[slug]/page.tsx` — public watch/share surface baseline
5. `apps/web/src/lib/content.ts` — content fetch layer for shareable pages

## Grep These

- `artifact` in `apps/manager/src/services/`
- `page.tsx` in `apps/web/src/app/`
- `template` in `docs/roadmap/media-generation/`
- `render` in `docs/roadmap/media-generation/`

## What To Build

1. Turn a custom-generation request into a durable public artifact with a stable link.
2. Decide what metadata, playback settings, and expiration rules belong on a shareable generated video.
3. Reuse the watch-platform surface where it fits so generated videos do not need a completely separate player stack.
4. Track enough provenance that the origin of a generated video can be inspected later.

## Constraints

- Do NOT create share links that bypass content safety or moderation checks.
- Generated outputs need stable metadata, not just a raw file URL.
- Keep storage and CDN behavior predictable for shared links.

## Verification

- A generated video can be opened through a stable share URL
- Shared videos retain the metadata needed for playback and attribution
- Operators can trace a shared artifact back to its source generation job
