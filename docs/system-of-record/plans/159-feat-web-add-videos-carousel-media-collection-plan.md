---
artifactType: plan
sourceIssueNumber: 159
sourceIssueTitle: "feat(web): add videos carousel (media collection)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/159"
linkedPrs: []
---

# Plan Artifact: #159

## Objective

- A component in `apps/web` that consumes videos carousel data (list of video items, optional heading/settings) and renders a video carousel with playback and navigation.

## Planned approach

1. Add `apps/web/src/components/sections/MediaVideosCarousel.tsx` or extend existing media collection renderer with a `videosCarousel` variant; reuse video player component.
2. Reuse shared carousel primitive; ensure video assets use same CDN/URL pattern as rest of app.

## Validation

- [ ] Videos carousel component implemented and wired to API/GraphQL shape.
- [ ] Renders video items (with poster/thumbnail if available); carousel navigation (prev/next or scroll).
- [ ] Video playback accessible and responsive; optional autoplay/muted per schema if supported.
- [ ] Integrated into dynamic zone or section rendering.

## Source links

- Issue: [#159](https://github.com/JesusFilm/forge/issues/159)
- PRs:
- None
