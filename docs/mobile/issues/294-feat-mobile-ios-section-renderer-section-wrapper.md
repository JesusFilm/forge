---
artifactType: issue
issueNumber: 294
issueTitle: "feat(mobile-ios): Section renderer – Section wrapper"
issueUrl: "https://github.com/JesusFilm/forge/issues/294"
state: "CLOSED"
closedAt: "2026-03-11T23:10:23Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #294

## Background

Experience sections include Section — a structural/nesting wrapper component that applies background styling and contains an inner `content` dynamic zone with up to 10 component types (including Container). This creates up to 3 levels of nesting: Experience.sections → Section.content → Container.slots[].content → leaf. This is a **Tier 2** renderer that depends on the Container renderer and all Tier 1 leaf renderers.

## Expected outcome

A SwiftUI view that renders Section wrapper data: applies background color/blurHash and recursively renders inner content including nested Containers and leaf components.

## Acceptance criteria

- [x] SectionWrapperView (or equivalent) takes `SectionWrapperSection` from data layer (#286).
- [x] Applies `backgroundColor` (default, light, dark, primary) as background styling.
- [x] Supports optional `blurHash` for background decoration.
- [x] Recursively renders inner `content` array — delegates to ContainerView for containers, LeafContentRendererView for leaf types.
- [x] Handles full 3-level nesting: Section → Container → leaf.
- [x] Standalone SwiftUI view at the top level of Experience.sections.
- [x] SwiftLint pass; accessible.

## Possible solution(s)

1. `VStack` with `.background()` modifier using backgroundColor enum mapping to SwiftUI colors. Inner content rendered via shared `SectionContentRendererView`.
2. BlurHash decoded as placeholder background image using a lightweight library or custom decoder.

## References

- Parent: #100
- Depends on: #286 (data layer expansion), Container renderer (#293), all Tier 1 leaf renderers
- CMS schema: `apps/cms/src/components/sections/section.json`
- Fields: `sectionKey`, `backgroundColor` (enum: default/light/dark/primary), `blurHash`, `content` dynamiczone (10 types: media-collection, text, promo-banner, info-blocks, cta, container, related-questions, bible-quotes-carousel, card, video)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
