---
title: "feat: Add roadmap hover preview popover"
type: "feat"
status: "completed"
date: "2026-04-07"
---

# feat: Add roadmap hover preview popover

## Overview

Add a read-only hover preview popover to roadmap timeline items on `/roadmap` so users can understand the minimum useful context for a ticket without opening the full `/ticket/[...id]` page.

The preview should feel like a compressed version of the existing ticket detail header plus a short problem summary. It should preserve the current click-through behavior, avoid clipping inside the horizontally scrollable timeline, and stay aligned with the roadmap app's filesystem-driven data model.

## Problem Statement / Motivation

Today the roadmap timeline shows only a narrow colored block with a truncated title. That works for scanning density, but it forces users to click into a separate page just to answer basic questions like:

- What is this item actually about?
- Who owns it, what is its status, and when is it scheduled?
- Is it blocked or dependent on something else?

The full ticket page already contains the right information architecture, but it is too heavy for quick inspection. We need a lightweight preview that gives users the key metadata and the core problem statement inline.

## Research Summary

### Local Context

- `apps/roadmap/components/RoadmapTimeline.tsx`
  - Already owns timeline hover state via `hoveredId`.
  - Already distinguishes hovered, dependency, blocked-by, and dimmed states.
  - Is a client component and the correct place for hover/focus interactions.
- `apps/roadmap/app/(dashboard)/ticket/[...id]/page.tsx`
  - Already defines the target content model for the preview header: status, priority, owner, timeline, lane, ID, tags, and dependency lists.
- `apps/roadmap/lib/features.ts`
  - Is the server-side source of truth for roadmap data.
  - Parses markdown files from `docs/roadmap/` and is the right place to derive a compact preview string from markdown content.
- `apps/roadmap/CLAUDE.md`
  - Confirms the app is filesystem-backed and should stay server-component-first.
  - Explicitly allows client interactivity in `RoadmapTimeline.tsx`.

### Institutional Learnings

- `docs/solutions/web/qr-code-preview-panel-roadmap.md`
  - Keep interactivity isolated to a small client surface.
  - Avoid adding unnecessary dependencies when a local component is enough.
  - Use explicit ARIA wiring and stable IDs for interactive panels.
  - Be careful about parent layout assumptions and clipping when rendering overlay-style UI.

### External Research Decision

Skipping external research. This is a low-risk app-local UI enhancement, the codebase already has strong patterns for interactive client islands, and the constraints are better answered by local implementation context than by general web articles.

## Proposed Solution

### 1. Extend roadmap feature data with a preview-safe problem excerpt

Add a derived preview field to `apps/roadmap/lib/features.ts` so each `Feature` includes a short plain-text summary extracted from markdown content.

Preferred extraction rule:

1. Find the `## Problem` section in the roadmap markdown body.
2. Take the first paragraph under that heading.
3. Collapse whitespace and trim to a readable preview length.
4. If no `## Problem` section exists, fall back to the first non-empty paragraph in the markdown body.

This keeps markdown parsing and content shaping on the server side and avoids shipping raw markdown parsing logic into the client timeline component.

Candidate shape:

```ts
// apps/roadmap/lib/features.ts
export type Feature = {
  // existing fields...
  problemPreview: string
}
```

### 2. Add a dedicated roadmap preview popover component

Create a focused component for the hover card, for example:

- `apps/roadmap/components/RoadmapFeaturePreviewPopover.tsx`

This component should render:

- Full title
- Status
- Priority
- Owner
- Timeline
- Lane
- ID
- Tags when present
- Depends On / Blocks when present
- A compressed `Problem` section using `feature.problemPreview`

The visual structure should mirror the existing ticket page metadata header, but in a smaller, scan-friendly layout intended for hover inspection rather than full reading.

### 3. Anchor the popover from the hovered roadmap block

Enhance `RoadmapTimeline.tsx` so hovering a timeline item opens a single active preview popover for that feature.

Recommended approach:

- Replace the current `hoveredId`-only interaction model with active preview state that can also track anchor position.
- Measure the hovered block with `getBoundingClientRect()`.
- Render the popover in a viewport-level layer using `position: fixed`.
- Recompute placement on:
  - hover/focus open
  - horizontal scroll of the timeline container
  - window resize
  - page scroll while open

Why fixed positioning:

- The timeline sits inside an `overflow-x-auto` container.
- An in-flow or absolutely positioned popover is likely to be clipped or constrained by the scroll area.
- A viewport-level overlay is more reliable for the card size shown in the requested mockup.

### 4. Prevent flicker and make the preview readable

The popover should remain open while the pointer moves from the bar to the popover itself.

Recommended interaction behavior:

- Open after a very small hover delay to avoid noisy flicker while scanning.
- Close after a short delay when leaving both the bar and the popover.
- Cancel close timers when re-entering.
- Keep the existing click behavior on the timeline bar so users can still navigate directly.

### 5. Preserve keyboard accessibility

Even though the user asked for hover, the preview should not become mouse-only.

Minimum keyboard support:

- Focusing a timeline item opens the same preview.
- `Escape` closes the active preview.
- Blurring away from both anchor and popover closes it.
- The popover content is read-only, so it should not trap focus.

### 6. Scope mobile/touch behavior deliberately

Do not force a popover pattern onto touch devices in this change.

Recommended scope:

- Enable the preview only for devices with hover-capable fine pointers.
- Keep current tap-to-open-ticket behavior unchanged on touch/coarse pointer devices.

This keeps the first version clear and avoids inventing a second interaction model mid-change.

## Technical Considerations

### Data shaping

- Keep excerpt extraction in `apps/roadmap/lib/features.ts`.
- Do not import `fs` or markdown parsing logic into client components.
- Keep the preview text plain-text only; do not render full markdown inside the hover card.

### Rendering strategy

- Prefer a single popover instance in `RoadmapTimeline.tsx` over one popover per item.
- Render it only for the active feature to reduce DOM noise in large timelines.
- Keep any new component presentation-only if possible, with state owned by `RoadmapTimeline.tsx`.

### Positioning

- Clamp the popover horizontally so it stays inside the viewport.
- Prefer showing below the hovered item; flip above only when needed.
- Ensure the popover does not cover the hovered card completely.

### Performance

- Timeline pages can render many rows, so avoid attaching expensive listeners to every item.
- Only bind scroll/resize observers while a preview is open.
- Precompute `problemPreview` once during feature parsing rather than on each hover.

### Styling

- Match the current roadmap palette and the existing ticket detail card hierarchy.
- Keep the preview visually subordinate to the full ticket page.
- Preserve current dependency highlighting behavior in the timeline while the preview is open.

## Spec Flow Notes

### Primary user flow

1. User scans `/roadmap`.
2. User hovers a timeline item.
3. Popover appears with essential metadata and problem summary.
4. User decides whether the item is relevant.
5. User either continues scanning or clicks through to the full ticket page.

### Edge cases to handle

- Hovered item is near the right edge of the viewport.
- Hovered item is near the top of the visible timeline.
- Timeline is horizontally scrolled.
- User moves pointer quickly across many items.
- Feature lacks tags or dependencies.
- Feature content lacks a `## Problem` heading.
- Keyboard user focuses the item instead of hovering.
- Touch device should not show a broken or stuck hover card.

## Acceptance Criteria

- [x] Hovering a roadmap timeline item on `/roadmap` shows a preview popover without navigating away.
- [x] The popover includes full title, status, priority, owner, timeline, lane, ID, and a compressed problem summary.
- [x] Tags are shown when present, and dependency metadata is shown when present.
- [x] The preview remains readable when moving the pointer from the item to the popover.
- [x] The popover is not clipped by the timeline scroll container.
- [x] Items near viewport edges reposition so the popover stays visible.
- [x] Focusing a timeline item with the keyboard opens the same preview.
- [x] Pressing `Escape` closes the preview.
- [x] Touch devices keep the current direct navigation behavior.
- [x] Items with no explicit `## Problem` section still show a reasonable fallback summary.

## Implementation Checklist

- [x] Add `problemPreview` extraction to `apps/roadmap/lib/features.ts`
- [x] Create a dedicated `RoadmapFeaturePreviewPopover` component
- [x] Wire hover/focus preview state and viewport positioning into `RoadmapTimeline.tsx`
- [x] Verify popover behavior after horizontal scrolling and near viewport edges
- [x] Run `pnpm --filter roadmap build`

## Success Metrics

- Users can identify what a roadmap item is about from the timeline alone in one hover.
- Click-throughs to the full ticket page become intentional deep dives rather than mandatory inspection clicks.
- No regression in timeline scanning, horizontal scroll behavior, or link navigation.

## Dependencies & Risks

### Dependencies

- `apps/roadmap/lib/features.ts` for preview text derivation
- `apps/roadmap/components/RoadmapTimeline.tsx` for interaction state and anchor measurement
- Existing badge/avatar components for consistent metadata rendering

### Risks

- Overlay clipping or mispositioning due to nested scroll containers
- Hover flicker if close/open timing is not coordinated
- Overly long preview text making the popover noisy or unstable
- Accessibility drift if hover logic is not mirrored for focus

### Mitigations

- Use fixed positioning with viewport clamping
- Use one active popover plus delayed close handling
- Limit `problemPreview` length and strip markdown formatting
- Add keyboard interaction and manual verification for focus flows

## Implementation Notes

Suggested files:

- `apps/roadmap/lib/features.ts`
- `apps/roadmap/components/RoadmapTimeline.tsx`
- `apps/roadmap/components/RoadmapFeaturePreviewPopover.tsx`

Optional extraction only if it clearly reduces duplication:

- `apps/roadmap/components/FeatureMetaSummary.tsx`

Avoid a larger ticket-page refactor unless duplication becomes obviously painful during implementation.

## Verification

- Open `/roadmap` locally and hover items in both early and late timeline positions
- Verify popover placement after horizontal scrolling the timeline
- Verify blocked, in-progress, complete, and not-started items all preview correctly
- Verify items with and without tags/dependencies
- Verify a ticket with a `## Problem` section uses that summary
- Verify a ticket without `## Problem` falls back cleanly
- Verify keyboard focus, blur, and `Escape`
- `pnpm --filter roadmap build`

## References & Research

### Internal References

- `apps/roadmap/components/RoadmapTimeline.tsx`
- `apps/roadmap/app/(dashboard)/ticket/[...id]/page.tsx`
- `apps/roadmap/lib/features.ts`
- `apps/roadmap/CLAUDE.md`
- `docs/roadmap/media-generation/feat-035-video-palyer-ux-for-autogenerated-subs.md`

### Institutional Learnings

- `docs/solutions/web/qr-code-preview-panel-roadmap.md`

## Open Questions

- Should the popover show both `Depends On` and `Blocks`, or only the more immediately actionable one when space is tight?
- Should the preview card include a small explicit “Open ticket” affordance, or should the hovered bar remain the sole navigation target in v1?
