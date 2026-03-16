---
artifactType: issue
issueNumber: 104
issueTitle: "feat(mobile-ios): Section renderer – MediaCollection"
issueUrl: "https://github.com/JesusFilm/forge/issues/104"
state: "CLOSED"
closedAt: "2026-03-11T21:39:15Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #104

## Background

Experience sections include MediaCollection (variant, items, enrichment). One of four section renderers; can be implemented in parallel with 4b–4d.

## Expected outcome

A SwiftUI view (and ViewModel if MVVM) that renders MediaCollection section data: variant (carousel/grid/collection/hero/player), items, and enrichment (video + overrides). Composable in the main experience view.

## Acceptance criteria

- [x] MediaCollectionView (or equivalent) takes section data from data layer.
- [x] Supports variant (e.g. carousel, grid) and displays items; enrichment (title, image) from video or overrides.
- [x] SwiftLint pass; <200 lines per file where practical; accessible (labels, Dynamic Type considered).

## Possible solution(s)

1. MediaCollectionView + MediaCollectionViewModel; map data layer section model to view state.
2. Reuse or align with schema: categoryLabel, variant, items[], optional title/subtitle/description/ctaLink.

## References

- Parent: #100
- Depends on: #103
- apps/cms/schema.graphql (ComponentSectionsMediaCollection)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
