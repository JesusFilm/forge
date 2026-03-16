---
artifactType: issue
issueNumber: 293
issueTitle: "feat(mobile-ios): Section renderer – Container (grid layout)"
issueUrl: "https://github.com/JesusFilm/forge/issues/293"
state: "CLOSED"
closedAt: "2026-03-11T22:36:16Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #293

## Background

Experience sections include Container — a structural/nesting component that provides grid layout via repeatable slots. Each slot has a `gridSpan` (1-12 columns) and its own `content` dynamic zone containing up to 7 leaf component types. This is a **Tier 2** renderer that depends on all Tier 1 leaf renderers being available.

## Expected outcome

A SwiftUI view that renders Container section data: adaptive grid layout where each slot occupies its `gridSpan` proportion of a 12-column grid, rendering nested leaf content within each slot.

## Acceptance criteria

- [x] ContainerView (or equivalent) takes `ContainerSection` from data layer (#286).
- [x] Renders slots in a grid layout (e.g. `LazyVGrid` or adaptive `HStack`/`VStack`) respecting `gridSpan` (1-12).
- [x] Each slot renders its nested `content` array via `LeafContentRendererView` (shared leaf renderer).
- [x] Handles variable number of slots and grid spans (e.g. two 6-span slots = 50/50; one 4-span + one 8-span = 33/67).
- [x] Standalone SwiftUI view — reusable at top level and inside Section wrapper.
- [x] SwiftLint pass; accessible.

## Possible solution(s)

1. `LazyVGrid` with `GridItem(.flexible())` weighted by `gridSpan`. On narrow screens (iPhone), stack vertically.
2. `GeometryReader` to calculate slot widths as `(gridSpan / 12.0) * availableWidth`.

## References

- Parent: #100
- Depends on: #286 (data layer expansion), all Tier 1 leaf renderers (#104-107, #287-292)
- CMS schema: `apps/cms/src/components/sections/container.json`, `apps/cms/src/components/sections/container-slot.json`
- Container fields: `sectionKey`, `slots[]`
- Slot fields: `gridSpan` (1-12, required), `content` dynamiczone (7 types: media-collection, text, related-questions, cta, bible-quotes-carousel, card, video)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
