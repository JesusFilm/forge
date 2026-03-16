---
artifactType: plan
sourceIssueNumber: 142
sourceIssueTitle: "feat(cms): add schema for VideoHero component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/142"
linkedPrs: []
---

# Plan Artifact: #142

## Objective

- A VideoHero component exists under `apps/cms/src/components` (or appropriate category).
- Schema supports video asset, optional heading/copy, and any layout/display options needed for the web app to render the hero.

## Planned approach

1. Add `components/sections/video-hero.json` (or `shared/video-hero`) with attributes: media (file or relation), heading, subheading, cta (optional).
2. Reuse existing media component if VideoHero is only a layout variant of a hero that already exists.

## Validation

- [ ] VideoHero component JSON schema added in CMS.
- [ ] Component registered and available in appropriate content types.
- [ ] GraphQL schema regenerated if contracts change.

## Source links

- Issue: [#142](https://github.com/JesusFilm/forge/issues/142)
- PRs:
- None
