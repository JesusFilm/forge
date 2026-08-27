---
id: "feat-439"
title: "Custom tiles in the Watch category rail block"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-27"
duration: 1
depends_on:
  - "feat-436"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "experiences"
  - "content-discovery"
---

## Problem

feat-436 gave admins control over WHICH predefined categories appear in the
Watch homepage rail and in what order. The tiles themselves stayed closed: title,
destination, icon, and gradient were all constants in `apps/web`, keyed off a
13-entry catalog. Admins could not add a tile for anything outside that catalog
(a campaign page, a partner link, a seasonal push) and could not adjust how an
existing tile reads.

## Entry Points — Read These First

1. `packages/watch-url-policy/src/watch-home-tiles.ts` — shared icon/style
   vocabularies, per-category defaults, and the destination policy.
2. `apps/admin/src/domain/blocks.ts` — `WatchHomeCategoryRailTileSchema` and the
   `tiles` field on `WatchHomeCategoryRailBlockSchema`.
3. `apps/admin/src/app/dashboard/experiences/experience-editor/watch-home-category-rail-tiles.ts`
   — editor-side normalization, the `categoryIds` mirror, inline validation.
4. `apps/web/src/lib/watch-home-tiles.ts` — render-time resolution and the
   defensive drops.
5. `docs/solutions/architecture-patterns/widening-a-closed-selection-block-into-an-authored-list-20260827.md`
   — the pattern write-up, including the two schema-lag error shapes.

## Grep These

- `watchHomeCategoryRail` — every layer of the block.
- `isSafeWatchHomeTileHref` — the destination policy, enforced at write AND render.
- `CATEGORY_RAIL_SCHEMA_LAG_MESSAGES` — the deploy-window fallback in
  `apps/web/src/lib/content.ts` and `experience-preview.ts`.
- `railBlockPatch` — where `categoryIds` is kept in sync with `tiles`.

## What Was Built

`tiles: [WatchHomeCategoryRailTile!]` on the block. Each tile is
`{ id, categoryId?, title?, href?, icon?, style? }`. A tile with a `categoryId`
is a predefined tile whose unset fields fall back to the catalog defaults
(including the localized title); any set field overrides that default. A tile
without a `categoryId` is fully custom and requires a title and a destination.

`categoryIds` stays required and becomes a compatibility mirror of the
predefined members, in tile order, so an `apps/web` deploy that predates `tiles`
still renders a correct rail during the deploy window.

The editor gained per-tile title/destination inputs, icon and style pickers with
a live swatch, an "Add custom tile" control, and inline validation. Reorder,
remove, and the accessible announcements carried over from feat-436.

## Constraints

- Do NOT drop `categoryIds` or make it nullable — it is the back-compat mirror.
- Do NOT accept a destination outside `/path` or `https://…`; the value lands in
  an `href` and the block is also writable through the Admin MCP surface.
- Do NOT localize an authored title — an authored title is deliberately a
  literal in every locale. Only unauthored predefined tiles are translated.
- Do NOT let the icon/style vocabularies drift between the editor and the
  renderer; both map the same shared keys through an exhaustive `Record`.

## Verification

```bash
pnpm --filter @forge/watch-url-policy test
pnpm --filter @forge/admin test
pnpm --filter @forge/web test
pnpm --filter @forge/admin schema:print   # must produce no further diff
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/web build            # the only check that covers typedRoutes
```

Client-bundle impact measured at +17.4 KB gzipped total client JS (+1.44%), of
which 14.0 KB is the nine added lucide glyphs; trimming the icon vocabulary is
the lever if that budget needs to come down.

## Follow-ups

- `feat-436` is still `status: in-progress` even though its scope shipped
  before this work started; someone with context should flip it.
- No migration writes `tiles` onto existing blocks. Stored rails keep rendering
  from `categoryIds` until an admin edits them, which is intentional — the first
  edit in the editor writes both shapes.
