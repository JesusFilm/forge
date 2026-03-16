---
artifactType: plan
sourceIssueNumber: 104
sourceIssueTitle: "feat(mobile-ios): Section renderer – MediaCollection"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/104"
linkedPrs: []
---

# Plan Artifact: #104

## Objective

A SwiftUI view (and ViewModel if MVVM) that renders MediaCollection section data: variant (carousel/grid/collection/hero/player), items, and enrichment (video + overrides). Composable in the main experience view.

## Planned approach

1. MediaCollectionView + MediaCollectionViewModel; map data layer section model to view state.
2. Reuse or align with schema: categoryLabel, variant, items[], optional title/subtitle/description/ctaLink.

## Validation

- [x] MediaCollectionView (or equivalent) takes section data from data layer.
- [x] Supports variant (e.g. carousel, grid) and displays items; enrichment (title, image) from video or overrides.
- [x] SwiftLint pass; <200 lines per file where practical; accessible (labels, Dynamic Type considered).

## Source links

- Issue: [#104](https://github.com/JesusFilm/forge/issues/104)
- PRs:
- None
