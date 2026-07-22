---
id: "feat-281"
title: "Watch media collection supporting title spacing"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
---

## Problem

The supporting title in a Watch media collection sits only 4px below the main
title, making the two authored fields feel visually crowded.

## Entry Points

1. `apps/web/src/components/sections/MediaCollection.tsx`
2. `apps/web/src/components/sections/MediaCollection.test.tsx`

## What To Build

Double the top spacing above a supporting title from 4px to 8px when a main
title is present. Make footer copy smaller than the collection description.
Make collection eyebrow labels smaller, more widely tracked, and more
translucent across all media collections. Preserve the existing spacing between
the supporting title and description, and preserve title-less layouts.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx`
- Browser smoke of the Acts collection at a wide viewport.

## Completion Evidence

- Focused `MediaCollection` Vitest: 29 tests passed.
- `@forge/web` typecheck passed.
- The supporting title receives `pt-1` only when the main title exists. Combined
  with the existing parent `gap-1`, this doubles the title-to-supporting-title
  spacing from 4px to 8px without changing the following description gap or
  title-less layout.
- Footer copy now renders at `text-xs xl:text-sm`, one type step below the
  description's `text-sm xl:text-base` sizing.
- All media-collection eyebrow labels now use `text-xs xl:text-sm 2xl:text-base`,
  `tracking-widest`, and `text-red-100/60` for a smaller, more widely spaced,
  more translucent treatment.
- The local Watch route returned HTTP 200, but browser proof could not render
  the Acts collection because the available Admin service belonged to another
  worktree and returned the page's existing `Failed to load experience` state.
