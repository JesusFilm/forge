---
artifactType: issue
issueNumber: 159
issueTitle: "feat(web): add videos carousel (media collection)"
issueUrl: "https://github.com/JesusFilm/forge/issues/159"
state: "CLOSED"
closedAt: "2026-03-16T02:45:49Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #159

## Background

The CMS will support a videos carousel via extended media collection schema (see #149). The web app needs a component that renders a carousel of video items from the media collection (or dedicated videos carousel block).

## Expected outcome

- A component in `apps/web` that consumes videos carousel data (list of video items, optional heading/settings) and renders a video carousel with playback and navigation.

## Acceptance criteria

- [ ] Videos carousel component implemented and wired to API/GraphQL shape.
- [ ] Renders video items (with poster/thumbnail if available); carousel navigation (prev/next or scroll).
- [ ] Video playback accessible and responsive; optional autoplay/muted per schema if supported.
- [ ] Integrated into dynamic zone or section rendering.

## Possible solution(s)

1. Add `apps/web/src/components/sections/MediaVideosCarousel.tsx` or extend existing media collection renderer with a `videosCarousel` variant; reuse video player component.
2. Reuse shared carousel primitive; ensure video assets use same CDN/URL pattern as rest of app.

## References

- Resolves/Implements schema: #149 (feat(cms): extend media collection to add videos carousel)
- `apps/cms/src/components/sections/media-collection.json`
- `apps/web` component structure

- Parent: #176 Epic B (Web)
- Related (CMS schema): #149

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
