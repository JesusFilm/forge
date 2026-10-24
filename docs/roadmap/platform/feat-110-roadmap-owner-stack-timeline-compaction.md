---
id: "feat-110"
title: "Roadmap Owner Stack Timeline Compaction"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "roadmap"
  - "frontend"
  - "timeline"
---

## Problem

The roadmap timeline currently renders each feature as its own full-height row. When one person is running several parallel tasks at the same time, the timeline expands vertically with repeated cards, repeated avatars, and repeated grid rows. That burns space and makes dense areas harder to scan.

## Entry Points - Read These First

1. `apps/roadmap/components/RoadmapTimeline.tsx` - current timeline row layout and feature block rendering.
2. `apps/roadmap/app/(dashboard)/roadmap/page.tsx` - dashboard route that mounts the current timeline view.
3. `apps/roadmap/components/RoadmapTimelinePanel.tsx` - planned/current wrapper introduced in the previous roadmap update.
4. `apps/roadmap/package.json` - roadmap app validation commands.

## Grep These

- `RoadmapTimeline` in `apps/roadmap/`
- `FeatureBlock` in `apps/roadmap/components/RoadmapTimeline.tsx`
- `groupBy === "lane"` in `apps/roadmap/components/RoadmapTimeline.tsx`

## What To Build

1. In the current roadmap timeline, collapse same-owner work inside a lane into a single owner row instead of one row per feature.
2. When the same owner has overlapping date ranges, render them as a compact visual stack inside that owner row rather than separate full-height rows.
3. Keep non-overlapping work for the same owner on the same owner row when possible.
4. Preserve ticket links, preview behavior, and lane/person grouping behavior.
5. Keep the timeline readable on both the lane and person grouping modes.

## Constraints

- Do not change the planned roadmap mode.
- Do not remove hover/focus preview behavior from feature cards.
- Do not change the source-of-truth feature data model in `apps/roadmap/lib/features.ts`.
- Keep the compaction logic local to the roadmap viewer.

## Verification

- `pnpm --filter roadmap lint`
- `pnpm --filter roadmap build`
- `pnpm --filter roadmap generate:readme`
- `curl -I http://localhost:3100/roadmap`
- Open `http://localhost:3100/roadmap` and confirm parallel tasks from one owner render as one compact stack instead of separate full-height rows.
