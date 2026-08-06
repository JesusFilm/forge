---
id: "feat-336"
title: "August-December 2026 Strategic Roadmap"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "roadmap"
  - "strategy"
  - "dashboard"
---

## Problem

The strategic roadmap at `/roadmap` still presents the April-August migration
plan and ends on August 10. The team has since shipped most of that foundation,
and recent product meetings and Slack discussions have established a different
set of priorities for the rest of 2026. Leaving the old plan in place makes the
stakeholder view stale even though the task tracker continues to move.

## Entry Points - Read These First

1. `apps/roadmap/lib/plannedRoadmap.ts` - static editorial timeline model for
   the strategic roadmap.
2. `apps/roadmap/components/PlannedRoadmapTimeline.tsx` - timeline rows,
   legends, bars, and detail-card rendering.
3. `apps/roadmap/app/(dashboard)/roadmap/page.tsx` - route-level framing and
   link to the operational task view.
4. `docs/solutions/platform/roadmap-planned-timeline-and-tasks-view-split.md` -
   why the strategic plan and live task tracker remain separate.
5. `docs/roadmap/platform/feat-109-roadmap-timeline-planned-current-modes.md` -
   original planned-timeline implementation and validation contract.

## Grep These

- `PLANNED_WEEK_COUNT|PLANNED_PHASES|PLANNED_TRACK_BARS` in `apps/roadmap/`
- `Delivery Planned|Delivery Actual|Research` in `apps/roadmap/`
- `Open Task View` in `apps/roadmap/`

## What To Build

1. Add an August-December 2026 plan without removing the original April-August
   delivery timeline.
2. Organize the plan around evidence-backed outcomes:
   - Watch reliability and operability
   - optional accounts, playback continuity, and manual partner handoff
   - YouTube-to-Watch/NextSteps journey validation
   - human-reviewed devotional production and distribution
   - multilingual translation quality and reviewer operations
   - alternating mobile and TV delivery
   - monthly demos, metrics review, and year-end 2027 planning
3. Keep every phase concrete enough to expose its deliverable, safety boundary,
   and exit criteria.
4. Update the route framing and legend to match the new tracks.
5. Preserve the original planned, actual, agent, mobile, and TV bars as a
   clearly labeled delivery-history section.
6. Preserve `/contributions` as the operational, file-backed task view.

## Constraints

- Keep the strategic roadmap as explicit editorial content; do not infer it
  from task status.
- Historical roadmap content is append-only: future planning may relabel it as
  history, but must not replace or silently remove it.
- Do not change the filesystem-backed task data model.
- Do not publish private meeting excerpts, names, or sensitive Slack context;
  only publish synthesized priorities authorized by the user.
- Keep public Watch browsing and playback anonymous-first.
- Keep human approval in the publication path for ministry-facing AI content.
- Do not imply that an experiment is validated before its measures are reviewed.

## Verification

- `pnpm --filter roadmap lint`
- `pnpm --filter roadmap build`
- `pnpm --filter roadmap generate:readme`
- `git diff --check`
- Browser smoke on `http://127.0.0.1:3100/roadmap` confirms the timeline spans
  August through December, the original April-August timeline and its planned
  and actual bars remain visible, all new bars have detail cards, and
  `/contributions` remains linked.
