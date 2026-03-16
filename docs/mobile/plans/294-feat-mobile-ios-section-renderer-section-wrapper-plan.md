---
artifactType: plan
sourceIssueNumber: 294
sourceIssueTitle: "feat(mobile-ios): Section renderer – Section wrapper"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/294"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #294

## Objective

A SwiftUI view that renders Section wrapper data: applies background color/blurHash and recursively renders inner content including nested Containers and leaf components.

## Planned approach

1. `VStack` with `.background()` modifier using backgroundColor enum mapping to SwiftUI colors. Inner content rendered via shared `SectionContentRendererView`.
2. BlurHash decoded as placeholder background image using a lightweight library or custom decoder.

## Validation

- [x] SectionWrapperView (or equivalent) takes `SectionWrapperSection` from data layer (#286).
- [x] Applies `backgroundColor` (default, light, dark, primary) as background styling.
- [x] Supports optional `blurHash` for background decoration.
- [x] Recursively renders inner `content` array — delegates to ContainerView for containers, LeafContentRendererView for leaf types.
- [x] Handles full 3-level nesting: Section → Container → leaf.
- [x] Standalone SwiftUI view at the top level of Experience.sections.
- [x] SwiftLint pass; accessible.

## Source links

- Issue: [#294](https://github.com/JesusFilm/forge/issues/294)
- PRs:
- None
