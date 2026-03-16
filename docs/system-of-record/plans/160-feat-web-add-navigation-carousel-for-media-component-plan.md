---
artifactType: plan
sourceIssueNumber: 160
sourceIssueTitle: "feat(web): add navigation carousel for media component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/160"
linkedPrs: []
---

# Plan Artifact: #160

## Objective

- Media carousel rendering in `apps/web` supports navigation (arrows, dots, keyboard) and optional loop when the block has navigation carousel options enabled.

## Planned approach

1. Extend existing `MediaCollection` or media section component to accept `carouselNavigation`, `showArrows`, `showDots`, `loop` and render navigation controls.
2. Use or introduce a shared carousel primitive that supports these options; keep media-specific logic (images/videos) in one place.

## Validation

- [ ] Media component (or media carousel) supports navigation UI (prev/next arrows, optional dots) from schema options.
- [ ] Optional loop and keyboard navigation; accessible (ARIA, focus); responsive.
- [ ] Wired to extended schema (showNavigation, showDots, loop) once available; integrated where media blocks are rendered.

## Source links

- Issue: [#160](https://github.com/JesusFilm/forge/issues/160)
- PRs:
- None
