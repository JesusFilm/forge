---
id: "feat-061"
title: "Watch Platform Upgrade (Bible Verse Visuals)"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-07-15"
duration: 48
depends_on:
  - "feat-054"
blocks: []
tags:
  - "web"
  - "watch"
  - "shared"
---

## Problem

This is shared work between Vlad and Tatai. The watch platform needs richer Bible verse visuals and a more deliberate storytelling layer so scripture-linked moments feel first-class in the viewing experience rather than bolted on as plain text.

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/page.tsx` — watch route
2. `apps/web/src/components/sections/Video.tsx` — player and adjacent watch UI
3. `apps/web/src/lib/fragments/bible-quotes-carousel.ts` — existing verse-oriented content fragment
4. `apps/cms/src/components/sections/bible-quotes-carousel.json` — CMS section contract for verse visuals
5. `docs/roadmap/media-generation/feat-054-video-pages-2-0.md` — single-video-page foundation

## Grep These

- `bible` in `apps/web/src/lib/fragments/`
- `Video` in `apps/web/src/components/sections/`
- `bible-quote` in `apps/cms/src/components/sections/`
- `watch` in `apps/web/src/app/`

## What To Build

1. Upgrade the watch-page presentation so Bible verse visuals can appear as purposeful visual modules, overlays, or supporting sections.
2. Connect verse presentation to CMS-driven content instead of hardcoding it into the player shell.
3. Keep the watch experience coherent across video, verse, and related-content modules.
4. Make the verse visual system reusable in later personalized and shareable experiences.

## Constraints

- Do NOT overload the video player with presentation responsibilities that belong in surrounding page sections.
- Reuse existing verse-related CMS primitives where possible before inventing new ones.
- Preserve accessibility and readability for scripture content on smaller screens.

## Verification

- A watch page can render Bible-verse visuals from CMS-backed data
- Verse visuals feel integrated with the video-page experience instead of separate fragments
- Mobile and desktop layouts both remain readable and intentional
