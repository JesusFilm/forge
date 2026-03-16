---
artifactType: issue
issueNumber: 222
issueTitle: "feat(cms): add schema for Video component"
issueUrl: "https://github.com/JesusFilm/forge/issues/222"
state: "CLOSED"
closedAt: "2026-03-08T20:48:56Z"
labels: ["cms", "feat"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #222

## Background

Need a Video section/component schema so editors can configure video blocks with a streaming URL, link to the existing video collection, optional media (e.g. poster/thumbnail), and display text (title, subtitle). This supports watch pages and other experiences that embed or reference video content.

## Expected outcome

- A Video component exists under `apps/cms/src/components` (sections or shared, as appropriate).
- Schema supports: streaming URL (string), relation to existing video collection type (`api::video.video`), media field (e.g. poster/thumbnail), title, and subtitle.
- Component can be registered in Experience (or other) content types and is available for the web app to render.

## Acceptance criteria

- [ ] Video component JSON schema added in CMS.
- [ ] Attributes include: streaming URL field, relation to video collection (`api::video.video`), media field, title, subtitle.
- [ ] Component registered and available in appropriate content types (e.g. Experience `sections` dynamic zone).
- [ ] GraphQL schema regenerated if contracts change.

## Possible solution(s)

1. Add `components/sections/video.json` with attributes: `streamingUrl` (string), `video` (relation manyToOne → `api::video.video`), `media` (media, single, e.g. images for poster), `title` (string), `subtitle` (string or text). Reuse existing patterns from VideoHero and Card for relation and media.
2. If the component is reusable outside sections (e.g. in containers), place under `components/shared/video.json` and register in both sections and container-slot content zones as needed.

## References

- `apps/cms/src/components/sections/` (or `shared/`)
- `apps/cms/src/api/video/content-types/video/schema.json` (existing video collection type)
- `apps/cms/schema.graphql` (generated)
- Parent: #175 Epic A (CMS)
- Related (web implementation): _to be created, e.g. feat(web): add Video component_

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
