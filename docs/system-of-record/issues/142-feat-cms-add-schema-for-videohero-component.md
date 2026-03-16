---
artifactType: issue
issueNumber: 142
issueTitle: "feat(cms): add schema for VideoHero component"
issueUrl: "https://github.com/JesusFilm/forge/issues/142"
state: "CLOSED"
closedAt: "2026-03-04T03:22:45Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #142

## Background

Need a Strapi section/component schema for VideoHero so editors can configure hero sections with video content in the CMS.

## Expected outcome

- A VideoHero component exists under `apps/cms/src/components` (or appropriate category).
- Schema supports video asset, optional heading/copy, and any layout/display options needed for the web app to render the hero.

## Acceptance criteria

- [ ] VideoHero component JSON schema added in CMS.
- [ ] Component registered and available in appropriate content types.
- [ ] GraphQL schema regenerated if contracts change.

## Possible solution(s)

1. Add `components/sections/video-hero.json` (or `shared/video-hero`) with attributes: media (file or relation), heading, subheading, cta (optional).
2. Reuse existing media component if VideoHero is only a layout variant of a hero that already exists.

## References

- `apps/cms/src/components/sections/`
- `apps/cms/schema.graphql` (generated)

- Parent: #175 Epic A (CMS)
- Related (web implementation): #152

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
