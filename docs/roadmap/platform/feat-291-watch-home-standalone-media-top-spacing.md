---
id: "feat-291"
title: "Align Watch home standalone media top spacing"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on:
  - "feat-286"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
  - "responsive"
---

## Problem

The Watch homepage now contains top-level `VideoCarouselBlock` and `VideoBlock`
content on the standard horizontal rail, but that rail has no vertical inset.
The New Believer Course copy therefore begins directly against the preceding
block boundary instead of matching the top spacing used by neighboring Watch
sections.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` — owns the
   homepage-only wrapper around standalone media blocks.
2. `apps/web/src/components/home/WatchHomeExperiencePage.test.tsx` — focused
   composition coverage for that wrapper.
3. `apps/web/src/components/sections/Section.tsx` — existing vertical section
   spacing pattern.
4. `docs/roadmap/platform/feat-286-watch-home-standalone-media-containment.md`
   — completed horizontal containment work this follow-up builds on.

## Grep These

- `data-watch-home-content-rail`
- `isStandaloneMediaBlock`
- `WATCH_PAGE_CONTENT_CLASSES`
- `VideoCarouselBlock`
- `VideoBlock`

## What To Build

1. Add the standard 4rem top inset to the homepage-owned wrapper for top-level
   `VideoCarouselBlock` and `VideoBlock` content.
2. Keep the existing horizontal rail, authored order, block content, and shared
   renderers unchanged.
3. Add a focused regression assertion that both standalone media wrappers own
   the top-spacing class.
4. Verify the New Believer Course block at the reported compact viewport.

## Constraints

- Do not change generic Experience routes or Watch detail pages.
- Do not change the shared content-width token or media renderer internals.
- Do not add bottom spacing, since following blocks already own their top inset.
- Preserve the full-bleed hero and self-contained section behavior.

## Verification

- `WatchHomeExperiencePage` focused test.
- Web typecheck and lint for the touched scope.
- Compact browser geometry and screenshot proof showing a 64px top inset.

## Validation Evidence

- Focused `WatchHomeExperiencePage` test passed.
- Web TypeScript, focused ESLint, Prettier, and `git diff --check` passed.
- Local `/watch` at 591×1280 computed `padding-top: 64px`, placed the copy
  64px below its wrapper and 20px from the viewport edge, and had zero
  horizontal overflow or browser errors.
- Screenshot: `output/playwright/watch-home-course-spacing-fixed.png`.
