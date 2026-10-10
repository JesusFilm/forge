---
title: "Roadmap planned timeline and tasks view split"
category: platform
date: 2026-04-29
tags:
  - roadmap
  - timeline
  - dashboard
  - information-architecture
  - nextjs
  - planned-data
  - tasks-view
  - hydration
---

# Roadmap planned timeline and tasks view split

## Problem

The roadmap viewer had drifted into an awkward hybrid. It was trying to serve two different jobs in one surface:

- a stakeholder-friendly strategic roadmap
- a contributor-facing live execution tracker

That made the page hard to read, hard to demo, and hard to maintain. The live ticket timeline was useful, but it was not a good vehicle for showing a clean 14-week migration narrative with milestones, parallel tracks, and rollout sequencing.

## Symptoms

- The roadmap page mixed planned narrative and source-of-truth task tracking.
- Stakeholders could not view a clean migration arc without also seeing dense task-level controls and ticket artifacts.
- Same-owner parallel work made the live timeline visually noisy.
- Planned bars needed repeated manual fixes for text overflow, label placement, and lane spacing.
- Milestone labels and date rows fought each other for space.
- The roadmap diagram exposed a visible horizontal scrollbar and had repeated alignment issues with the page shell.
- The `Today` marker produced a hydration mismatch because its position differed between SSR and the client.

## What Didn't Work

### Keeping planned and live views in one mode switch

The original direction started as a `planned | current` toggle inside the same roadmap page. That improved things at first, but the two views still wanted different layout, legend, navigation, and interaction models.

### Treating planned content like live task data

The live timeline is driven by filesystem-backed roadmap tickets. The planned roadmap needed stable editorial content: fixed phases, milestone labels, lane bars, summaries, and anchor-linked detail sections. Trying to make one model drive both surfaces created unnecessary complexity.

### Layering visual tweaks without a dedicated planned model

Once the roadmap started accumulating milestone hairlines, breakout layout, stacked research/mobile sublanes, hover states, and beta rollout labels, it became clear that the planned view needed its own small data model and renderer.

## Solution

### 1. Split strategy from execution

The final pattern uses separate routes:

- `/roadmap` for the strategic planned roadmap
- `/contributions` for the live task breakdown

This keeps the roadmap polished and narrative-driven while preserving the live ticket timeline as the operational source of truth.

### 2. Keep live task data intact

The file-backed roadmap feature model stays unchanged for the tasks page. `ContributionsTimelinePanel.tsx` keeps the existing live timeline and grouping controls like:

- `By Lane`
- `By Person`

This avoided turning planned roadmap work into a mutation of the task system.

### 3. Introduce a dedicated planned roadmap model

The planned view is driven by `apps/roadmap/lib/plannedRoadmap.ts`, which acts like a small timeline DSL with separate concepts for:

- `PLANNED_PHASES`
- `PLANNED_TRACK_BARS`
- `PLANNED_MILESTONES`
- `PLANNED_TIMELINE_ROWS`

That distinction matters:

- phases represent major delivery blocks with detail cards
- track bars represent parallel or follow-on work on the same lane
- milestones represent overlay markers, not rows

### 4. Use a dedicated planned timeline renderer

`apps/roadmap/components/PlannedRoadmapTimeline.tsx` renders the roadmap in three layers:

- week/date header
- timeline body with bars and milestone hairlines
- detail cards below

Each timeline bar links directly to a detail section using stable anchor ids:

- `planned-phase-*`
- `planned-track-*`

This made the diagram interactive without introducing extra routing complexity.

### 5. Reuse the public shell for roadmap-facing pages

`/roadmap` and `/contributions` both use the shared top navigation shell through `DashboardShell.tsx`, matching the visual language of `Home`, `About`, and `Experiments`.

The diagram itself is allowed to break out wider than the content column, but:

- hero content stays aligned with the shared shell
- supporting cards below the diagram stay within the normal content width

### 6. Fix roadmap-specific UI problems in the planned renderer

The dedicated planned renderer made it straightforward to solve repeated UI issues:

- current timeline compaction for same-owner parallel work
- milestone labels above the date row with connected hairlines
- hidden horizontal scrollbar while preserving scroll behavior
- cleaner timeline hero and legend placement
- stronger hover affordances on bars
- repeated two-week research/mobile cadence blocks
- beta labeling for internal mobile/TV releases
- taller stacked sub-lane rows so badge, title, and summary fit
- client-safe `Today` marker rendering to avoid hydration mismatch

## Files

Primary implementation files:

- `apps/roadmap/app/(dashboard)/roadmap/page.tsx`
- `apps/roadmap/app/(dashboard)/contributions/page.tsx`
- `apps/roadmap/components/PlannedRoadmapTimeline.tsx`
- `apps/roadmap/components/ContributionsTimelinePanel.tsx`
- `apps/roadmap/components/RoadmapTimeline.tsx`
- `apps/roadmap/components/DashboardShell.tsx`
- `apps/roadmap/lib/plannedRoadmap.ts`

Tracking references:

- `docs/roadmap/platform/feat-109-roadmap-timeline-planned-current-modes.md`
- `docs/roadmap/platform/feat-110-roadmap-owner-stack-timeline-compaction.md`

## Why This Works

- It separates stakeholder storytelling from contributor execution.
- It preserves the live task model as the source of truth.
- It gives the planned roadmap a stable, explicit content model.
- It keeps the visual system maintainable by centralizing timeline geometry and tone rules in one renderer.
- It makes browser-level UI iteration easier because all roadmap-specific behavior lives in a focused set of files.

## Prevention

### Keep planned and live data separate

- Treat planned roadmap content as editorial timeline data.
- Treat tasks/contributions as operational live data.
- Do not create hybrid components that accept both shapes through optional branches.

### Keep timeline items deterministic

- Every phase, track bar, milestone, and detail section should have a stable id.
- Click-to-scroll, hover detail, and anchors should all reference explicit ids rather than derived display strings.

### Keep time-based UI client-safe

- Normalize or defer time-sensitive decorations like `Today` until after mount when necessary.
- Avoid server/client drift for timeline marker positioning.

### Centralize layout geometry

Keep constants such as:

- week width
- label band height
- track label width
- stacked row height
- bar gap

in one place so repeated spacing adjustments do not turn into hidden magic values.

### Prefer narrow browser-proof validation

For roadmap UI work, compile success is not enough. Validate in the browser that:

- the page loads at the intended route
- there are no hydration warnings
- hover states feel correct
- milestone labels sit in the correct band
- text is not cropped inside bars
- breakout diagrams still align with contained content
- click-to-scroll anchors land on the correct detail card

## Validation

This work was repeatedly validated with:

- `pnpm --filter roadmap lint`
- `pnpm --filter roadmap build`
- `pnpm --filter roadmap generate:readme`
- `git diff --check`
- `curl -I http://localhost:3100/roadmap`
- `curl -I http://localhost:3100/contributions`
- browser verification against the live local pages

## Related References

- PR `#856` - `feat(roadmap): add planned roadmap and tasks views`
- `docs/roadmap/platform/feat-109-roadmap-timeline-planned-current-modes.md`
- `docs/roadmap/platform/feat-110-roadmap-owner-stack-timeline-compaction.md`
- `docs/roadmap/platform/feat-033-roadmap-dashboard-app.md`
- `docs/brainstorms/2026-03-31-roadmap-landing-page-requirements.md`
- `docs/solutions/ui-bugs/react-duplicate-sibling-keys-append-on-rerender-20260421.md`
