---
artifactType: plan
sourceIssueNumber: 293
sourceIssueTitle: "feat(mobile-ios): Section renderer – Container (grid layout)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/293"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #293

## Objective

A SwiftUI view that renders Container section data: adaptive grid layout where each slot occupies its `gridSpan` proportion of a 12-column grid, rendering nested leaf content within each slot.

## Planned approach

1. `LazyVGrid` with `GridItem(.flexible())` weighted by `gridSpan`. On narrow screens (iPhone), stack vertically.
2. `GeometryReader` to calculate slot widths as `(gridSpan / 12.0) * availableWidth`.

## Validation

- [x] ContainerView (or equivalent) takes `ContainerSection` from data layer (#286).
- [x] Renders slots in a grid layout (e.g. `LazyVGrid` or adaptive `HStack`/`VStack`) respecting `gridSpan` (1-12).
- [x] Each slot renders its nested `content` array via `LeafContentRendererView` (shared leaf renderer).
- [x] Handles variable number of slots and grid spans (e.g. two 6-span slots = 50/50; one 4-span + one 8-span = 33/67).
- [x] Standalone SwiftUI view — reusable at top level and inside Section wrapper.
- [x] SwiftLint pass; accessible.

## Source links

- Issue: [#293](https://github.com/JesusFilm/forge/issues/293)
- PRs:
- None
