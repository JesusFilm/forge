---
artifactType: issue
issueNumber: 149
issueTitle: "feat(cms): extend media collection to add videos carousel"
issueUrl: "https://github.com/JesusFilm/forge/issues/149"
state: "CLOSED"
closedAt: "2026-03-05T21:48:53Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #149

## Background

The media collection (or media-related sections) should support a videos carousel so editors can configure a set of videos to be shown in a carousel on the web.

## Expected outcome

- Media collection (or a dedicated media carousel component) supports video items and carousel configuration (e.g. repeatable video entries, optional heading, autoplay/settings).

## Acceptance criteria

- [ ] Schema supports a list of video items (file or media relation) and optional carousel options.
- [ ] Existing media collection or new component extended/added; GraphQL regenerated if contracts change.

## Possible solution(s)

1. Extend `sections/media-collection.json` with a `variant` or `type` (e.g. `videos-carousel`) and ensure items can be video type.
2. Add `sections/media-carousel.json` (or `videos-carousel.json`) that reuses media item component with video-specific fields.

## References

- `apps/cms/src/components/sections/media-collection.json`
- `apps/cms/src/components/sections/media-collection-item.json`
- `apps/cms/schema.graphql`

- Parent: #175 Epic A (CMS)
- Related (web implementation): #159

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
