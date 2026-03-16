---
artifactType: plan
sourceIssueNumber: 222
sourceIssueTitle: "feat(cms): add schema for Video component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/222"
linkedPrs: []
---

# Plan Artifact: #222

## Objective

- A Video component exists under `apps/cms/src/components` (sections or shared, as appropriate).
- Schema supports: streaming URL (string), relation to existing video collection type (`api::video.video`), media field (e.g. poster/thumbnail), title, and subtitle.
- Component can be registered in Experience (or other) content types and is available for the web app to render.

## Planned approach

1. Add `components/sections/video.json` with attributes: `streamingUrl` (string), `video` (relation manyToOne → `api::video.video`), `media` (media, single, e.g. images for poster), `title` (string), `subtitle` (string or text). Reuse existing patterns from VideoHero and Card for relation and media.
2. If the component is reusable outside sections (e.g. in containers), place under `components/shared/video.json` and register in both sections and container-slot content zones as needed.

## Validation

- [ ] Video component JSON schema added in CMS.
- [ ] Attributes include: streaming URL field, relation to video collection (`api::video.video`), media field, title, subtitle.
- [ ] Component registered and available in appropriate content types (e.g. Experience `sections` dynamic zone).
- [ ] GraphQL schema regenerated if contracts change.

## Source links

- Issue: [#222](https://github.com/JesusFilm/forge/issues/222)
- PRs:
- None
