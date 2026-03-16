---
artifactType: issue
issueNumber: 150
issueTitle: "feat(cms): extend media component to add navigation carousel"
issueUrl: "https://github.com/JesusFilm/forge/issues/150"
state: "CLOSED"
closedAt: "2026-03-06T01:28:46Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #150

## Background

The media component (e.g. media collection or single-media block) should support a navigation carousel so users can browse through media items with prev/next or dots.

## Expected outcome

- Schema and/or component options support a "navigation carousel" mode (e.g. show arrows, dots, keyboard nav) so the web app can render a carousel with navigation.

## Acceptance criteria

- [ ] Media component schema or options include carousel navigation (e.g. `showNavigation`, `showDots`, `loop`).
- [ ] Changes reflected in CMS and GraphQL; codegen run if contracts change.

## Possible solution(s)

1. Add optional boolean/enum fields to `media-collection.json` or `media-collection-item.json`: `carouselNavigation`, `showArrows`, `showDots`.
2. Introduce a `MediaCarousel` wrapper component that wraps media items and carries navigation options.

## References

- `apps/cms/src/components/sections/media-collection.json`
- `apps/cms/src/components/sections/media-collection-item.json`
- `apps/cms/schema.graphql`

- Parent: #175 Epic A (CMS)
- Related (web implementation): #160

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
