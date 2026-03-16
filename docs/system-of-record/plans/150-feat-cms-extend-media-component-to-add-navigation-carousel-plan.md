---
artifactType: plan
sourceIssueNumber: 150
sourceIssueTitle: "feat(cms): extend media component to add navigation carousel"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/150"
linkedPrs: []
---

# Plan Artifact: #150

## Objective

- Schema and/or component options support a "navigation carousel" mode (e.g. show arrows, dots, keyboard nav) so the web app can render a carousel with navigation.

## Planned approach

1. Add optional boolean/enum fields to `media-collection.json` or `media-collection-item.json`: `carouselNavigation`, `showArrows`, `showDots`.
2. Introduce a `MediaCarousel` wrapper component that wraps media items and carries navigation options.

## Validation

- [ ] Media component schema or options include carousel navigation (e.g. `showNavigation`, `showDots`, `loop`).
- [ ] Changes reflected in CMS and GraphQL; codegen run if contracts change.

## Source links

- Issue: [#150](https://github.com/JesusFilm/forge/issues/150)
- PRs:
- None
