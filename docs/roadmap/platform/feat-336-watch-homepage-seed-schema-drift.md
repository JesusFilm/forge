---
id: "feat-336"
title: "Repair Watch homepage Experience seed schema drift"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: null
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "watch"
  - "experiences"
  - "local-development"
---

## Problem

`seed-watch-homepage-experience` fails before writing its homepage Experience
because generated media items still include `imageUrl`, which the current
strict media-item block schema rejects as an unrecognized key.

## Entry Points

1. `apps/admin/src/scripts/seed-watch-homepage-experience.ts` - media-item
   construction and block validation.
2. `apps/admin/src/domain/blocks.ts` - current strict media-item schema.
3. `apps/admin/src/scripts/seed-watch-homepage-experience.test.ts` - regression
   coverage for the generated homepage payload.

## Grep These

- `compactMediaItem`
- `buildMediaItem`
- `imageUrl`
- `blocksSchema.safeParse`

## What To Build

1. Align seeded media-item fields with the current block schema and renderer.
2. Preserve Admin video references and image behavior without reintroducing a
   deprecated free-form image field.
3. Add a regression test that parses the complete generated block payload.

## Verification

- Run the seed against an isolated, current-schema local Admin database.
- Confirm it publishes one homepage Experience and reports the expected block
  and referenced-video counts.
