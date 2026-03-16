---
artifactType: plan
sourceIssueNumber: 134
sourceIssueTitle: "feat(cms): add gridColumns and gridMaxRows to MediaCollection"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/134"
linkedPrs: []
---

# Plan Artifact: #134

## Objective

- Media collection component has optional `gridColumns` (number of columns on wide viewports) and `gridMaxRows` (cap on visible rows; rows otherwise inferred from item count).
- GraphQL schema and codegen updated; no hand-edits in `packages/graphql`.

## Planned approach

1. Add `gridColumns` and `gridMaxRows` (type integer, required false) to `apps/cms/src/components/sections/media-collection.json`. Strapi build + dev for schema; run `pnpm codegen`.

## Validation

- [ ] Optional `gridColumns` and `gridMaxRows` (integers) added to media-collection component.
- [ ] `apps/cms/schema.graphql` and codegen reflect the new fields.
- [ ] CI passes; PR merged after review.

## Source links

- Issue: [#134](https://github.com/JesusFilm/forge/issues/134)
- PRs:
- None
