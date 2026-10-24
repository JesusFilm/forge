---
id: "feat-277"
title: "Admin Editor Collection Child Expansion"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on:
  - "feat-274"
  - "feat-275"
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
  - "editor"
---

## Problem

The Experience editor lets an author select a collection in the media picker
for Video Carousel and Media Collection blocks, but confirming that selection
adds the collection container as one item. Authors expect a collection choice
to populate the block with that collection's direct videos in authored order.

## Entry Points

1. `apps/admin/src/app/dashboard/live-data.ts`
2. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
3. `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
5. `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`

## What To Build

1. Load a selected collection's immediate children on demand in canonical
   `VideoRelation.order` order.
2. Expand a collection selection into child items for Video Carousel blocks.
3. Apply the same behavior to Media Collection `carousel`, `grid`, and
   `collection` variants.
4. Preserve existing block item order, append children in collection order,
   and skip already-present children without adding the parent collection.
5. Keep the picker open and the block unchanged when child loading fails.

## Constraints

- Do not recursively expand grandchildren.
- Do not preload every child of every visible collection when the editor opens.
- Preserve ordinary single-video selection behavior.
- Do not change Admin GraphQL or public Watch rendering contracts.

## Verification

- Focused Admin live-data and Experience editor tests.
- Admin typecheck and formatting/CI-sensitive checks for touched files.
- Browser smoke the collection selection flow and capture the populated block.

## Completion Notes

Completed on 2026-07-21.

- Added authenticated, on-demand hydration for immediate collection children.
- Preserved numeric relation order, placed null-order relations last, and used
  creation time as the stable tie-breaker.
- Expanded collection selections for Video Carousel and Media Collection
  `carousel`, `grid`, and `collection` variants without storing the parent or
  recursively expanding grandchildren.
- Preserved existing item order, skipped duplicates, retained ordinary leaf
  behavior, and kept picker/block state intact on empty or failed loads.
- Passed 51 focused Admin tests, Admin typecheck, and Admin lint.
- Passed an isolated browser smoke using the real Experience editor and a
  restored catalogue: the five LUMO children appeared in database relation
  order and the collection parent was absent. Visual proof:
  `output/playwright/collection-children-populated.png`.
