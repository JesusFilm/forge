---
title: "fix: Prevent roadmap timeline week columns from compressing"
type: fix
status: completed
date: 2026-04-07
---

# fix: Prevent roadmap timeline week columns from compressing

## Overview

The roadmap timeline currently lays out week headers, grid lines, and feature blocks inside a container with a fixed `min-w-[600px]`. As the number of week columns grows, each visual week becomes narrower and narrower, which makes the calendar hard to read and causes the feature blocks to feel crushed together. The fix is to make the rendered timeline width scale with the number of weeks so every week section keeps a minimum visual width of `60px` while horizontal scrolling absorbs the overflow.

## Problem Statement / Motivation

The current rendering in `apps/roadmap/components/RoadmapTimeline.tsx` is percentage-based:

- the inner timeline wrapper uses `min-w-[600px]`
- week headers compute width as a percentage of total days
- feature blocks compute `left` and `width` as percentages of total days

That works for short timelines, but once the roadmap spans many weeks, the whole grid is still squeezed into a container that is too narrow. The screenshot shows the practical result: labels truncate aggressively, week divisions become visually dense, and the timeline loses its usefulness as a planning tool.

This matters because the roadmap view is one of the app’s main stakeholder-facing surfaces. If the calendar becomes unreadable as more roadmap items are added, the viewer stops scaling with the roadmap itself.

## Proposed Solution

Keep the existing timeline interaction model, but replace the fixed minimum timeline width with a width derived from the number of rendered week sections.

High-level approach:

1. Compute a `timelineMinWidthPx` value from the number of week columns.
2. Ensure the scrollable inner timeline uses at least `60px` per rendered week section.
3. Keep feature block positioning aligned with the same timeline geometry so blocks, headers, and vertical grid lines stay in sync.
4. Verify that the timeline remains readable on both smaller and larger screens, with horizontal scrolling handling overflow instead of compression.

## Technical Considerations

### Relevant Code and Patterns

- `apps/roadmap/components/RoadmapTimeline.tsx`
  - `buildWeekColumns()` builds the rendered week sections.
  - `weekColumns` is the source of truth for header cells and week grid lines.
  - The current inner wrapper uses `min-w-[600px]`.
  - `FeatureBlock` positions items with percentage-based `left` and `width`.
- `apps/roadmap/app/(dashboard)/roadmap/page.tsx`
  - Confirms `RoadmapTimeline` is the dashboard timeline entrypoint.
- `apps/roadmap/CLAUDE.md`
  - Confirms this app is a filesystem-driven Next.js viewer and `RoadmapTimeline.tsx` is intentionally client-side for interactivity.

### Likely Implementation Shape

- Replace the hardcoded `min-w-[600px]` wrapper with a style-driven minimum width:

```tsx
// apps/roadmap/components/RoadmapTimeline.tsx
const MIN_WEEK_WIDTH_PX = 60
const timelineMinWidthPx = Math.max(600, weekColumns.length * MIN_WEEK_WIDTH_PX)
```

- Apply that value to the inner timeline container:

```tsx
// apps/roadmap/components/RoadmapTimeline.tsx
<div className="relative" style={{ minWidth: `${timelineMinWidthPx}px` }}>
```

- Keep header widths, grid lines, and feature blocks derived from the same timeline range so they continue to align.

### Important Edge Cases

- The first or last rendered column may be shorter than a full week if the visible range is buffered by a few days. During implementation, confirm whether the current range math allows a week section to still render under `60px` even after the container widens.
- If that happens, the fix should normalize the visual timeline range to week boundaries or compute the minimum width from actual rendered week spans rather than raw `weekColumns.length`.
- Horizontal scrolling must remain smooth and predictable; the fix should not collapse the sticky “Today” marker or make hover interactions drift out of alignment.

## Spec Flow Notes

### Primary User Flow

1. A stakeholder opens `/roadmap`.
2. The timeline renders all week sections for the current roadmap range.
3. Each week section remains visually readable at a minimum width of `60px`.
4. If the timeline is wider than the viewport, the user scrolls horizontally instead of the weeks compressing.

### Failure Mode to Eliminate

1. The roadmap grows to many weeks.
2. The timeline wrapper stays too narrow.
3. Week sections compress below readable width.
4. Labels and blocks overlap visually or become too dense to scan.

### Acceptance-Oriented Edge Cases

- Very long timelines with many future tickets
- Shorter timelines that should still keep sane default spacing
- Lane and person grouping modes
- “Today” marker alignment after the width change

## Acceptance Criteria

- [x] Every rendered week section in `RoadmapTimeline` has a minimum visual width of `60px`
- [x] The timeline no longer compresses as more week columns are added; overflow is handled by horizontal scrolling
- [x] Week headers, week grid lines, feature blocks, and the “Today” marker remain aligned after the width change
- [x] Both grouping modes (`By Lane` and `By Person`) render correctly with the new width behavior
- [x] The fix does not regress existing hover, dependency-highlighting, or link behavior in the timeline

## Success Metrics

- Timeline readability remains stable as roadmap duration grows
- Week labels remain visually scannable in the browser for large roadmap ranges
- Feature blocks preserve clear spacing and alignment relative to week boundaries

## Dependencies & Risks

### Dependencies

- No external dependencies are required
- The fix is isolated to the roadmap viewer component unless range normalization also requires a small helper refactor

### Risks

- A naive `weekColumns.length * 60` calculation may still leave partial edge weeks under-sized if the visible range is not snapped to week boundaries
- Width changes could accidentally desynchronize header cells, grid lines, and feature blocks if they stop sharing the same geometry assumptions
- A very wide timeline may expose minor UX issues around scroll affordance that are currently hidden by compression

## Implementation Notes

- Prefer keeping the current percentage-based block placement if possible; it is simpler and already consistent with the existing hover/highlight behavior.
- If percentage layout cannot guarantee the `60px` minimum for every visual week section, move to a shared pixel-based width model derived from week spans rather than patching headers and blocks independently.
- Keep the change local to `RoadmapTimeline.tsx` unless a shared helper meaningfully simplifies the range math.

## Testing & Verification

- Open the local roadmap viewer and inspect `/roadmap` with the current expanded dataset
- Confirm each week section is at least `60px` wide in the rendered timeline
- Confirm horizontal scrolling appears instead of week compression on narrower windows
- Toggle `By Lane` and `By Person`
- Hover feature blocks and confirm dependency highlighting still matches the correct blocks
- Confirm the “Today” marker still lands on the correct date position

## References & Research

### Internal References

- `apps/roadmap/components/RoadmapTimeline.tsx`
- `apps/roadmap/app/(dashboard)/roadmap/page.tsx`
- `apps/roadmap/CLAUDE.md`

### Institutional Learnings

- No matching `docs/solutions/` entry was found for roadmap timeline sizing or minimum-width calendar behavior, so the implementation should stay close to the existing component structure and avoid speculative abstraction.
