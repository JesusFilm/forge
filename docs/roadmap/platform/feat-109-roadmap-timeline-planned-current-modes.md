---
id: "feat-109"
title: "Roadmap Timeline Planned/Current Modes"
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
  - "dashboard"
---

## Problem

The roadmap dashboard currently shows only the live ticket timeline derived from `docs/roadmap/`. That is useful for current execution, but it does not give stakeholders a clean way to view the higher-level migration narrative for the next few months. We need a second timeline mode that can present a planned migration arc without replacing the current source-of-truth ticket view.

## Entry Points - Read These First

1. `apps/roadmap/app/(dashboard)/roadmap/page.tsx` - dashboard route that assembles the roadmap timeline inputs.
2. `apps/roadmap/components/RoadmapTimeline.tsx` - existing client timeline for current roadmap tickets.
3. `apps/roadmap/lib/features.ts` - current roadmap ticket loading and timeline metadata.
4. `apps/roadmap/package.json` - roadmap app validation commands.
5. `docs/roadmap/README.md` - derived roadmap index that should be regenerated after adding this ticket.

## Grep These

- `RoadmapTimeline` in `apps/roadmap/`
- `getAllFeatures` in `apps/roadmap/`
- `generate:readme` in `apps/roadmap/package.json`

## What To Build

1. Add a timeline mode switch in the roadmap dashboard with `planned` and `current` options.
2. Keep `current` wired to the existing live feature timeline based on `docs/roadmap/`.
3. Add a separate planned timeline surface that shows the requested Forge migration narrative:
   - roadmap goal and cadence
   - external deadline milestone
   - parallel tracks
   - phased build/release sequence
   - demo day milestone
   - ongoing mobile/TV and agentic tracks
   - end-state success criteria and framing text
4. Keep the existing ticket-derived data model intact. The planned mode should be additive, not a replacement for live roadmap data.
5. Validate the roadmap app locally after the UI change.

## Constraints

- Do not change the filesystem-backed roadmap data model for current tickets.
- Do not remove the existing lane/person grouping controls for the current timeline.
- Keep planned mode content static and explicit rather than trying to infer it from current feature files.
- Keep the implementation inside `apps/roadmap/`; no CMS or shared package changes.

## Verification

- `pnpm --filter roadmap lint`
- `pnpm --filter roadmap build`
- `pnpm --filter roadmap generate:readme`
- `pnpm --filter roadmap dev`
- Open `http://localhost:3100/roadmap` and verify the `planned` and `current` timeline modes both render.
