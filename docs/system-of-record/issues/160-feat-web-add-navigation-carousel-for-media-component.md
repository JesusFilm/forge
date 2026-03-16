---
artifactType: issue
issueNumber: 160
issueTitle: "feat(web): add navigation carousel for media component"
issueUrl: "https://github.com/JesusFilm/forge/issues/160"
state: "CLOSED"
closedAt: "2026-03-16T02:45:51Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #160

## Background

The CMS will support navigation carousel options on the media component (see #150). The web app needs to render media (image/video) carousels with navigation (arrows, dots, optional loop) when the schema indicates it.

## Expected outcome

- Media carousel rendering in `apps/web` supports navigation (arrows, dots, keyboard) and optional loop when the block has navigation carousel options enabled.

## Acceptance criteria

- [ ] Media component (or media carousel) supports navigation UI (prev/next arrows, optional dots) from schema options.
- [ ] Optional loop and keyboard navigation; accessible (ARIA, focus); responsive.
- [ ] Wired to extended schema (showNavigation, showDots, loop) once available; integrated where media blocks are rendered.

## Possible solution(s)

1. Extend existing `MediaCollection` or media section component to accept `carouselNavigation`, `showArrows`, `showDots`, `loop` and render navigation controls.
2. Use or introduce a shared carousel primitive that supports these options; keep media-specific logic (images/videos) in one place.

## References

- Resolves/Implements schema: #150 (feat(cms): extend media component to add navigation carousel)
- `apps/cms/src/components/sections/media-collection.json`
- `apps/web` component structure

- Parent: #176 Epic B (Web)
- Related (CMS schema): #150

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
