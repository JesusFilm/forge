---
artifactType: plan
sourceIssueNumber: 149
sourceIssueTitle: "feat(cms): extend media collection to add videos carousel"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/149"
linkedPrs: []
---

# Plan Artifact: #149

## Objective

- Media collection (or a dedicated media carousel component) supports video items and carousel configuration (e.g. repeatable video entries, optional heading, autoplay/settings).

## Planned approach

1. Extend `sections/media-collection.json` with a `variant` or `type` (e.g. `videos-carousel`) and ensure items can be video type.
2. Add `sections/media-carousel.json` (or `videos-carousel.json`) that reuses media item component with video-specific fields.

## Validation

- [ ] Schema supports a list of video items (file or media relation) and optional carousel options.
- [ ] Existing media collection or new component extended/added; GraphQL regenerated if contracts change.

## Source links

- Issue: [#149](https://github.com/JesusFilm/forge/issues/149)
- PRs:
- None
