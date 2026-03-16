---
artifactType: issue
issueNumber: 134
issueTitle: "feat(cms): add gridColumns and gridMaxRows to MediaCollection"
issueUrl: "https://github.com/JesusFilm/forge/issues/134"
state: "CLOSED"
closedAt: "2026-02-27T00:48:49Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #134

## Background

Epic #120 (Experience schema for full watch-page parity) requires configurable grid layout for collection sections: control how many columns (and optionally max rows) when variant is grid. Per the epic plan, we add two optional integer fields to Media collection only.

## Expected outcome

- Media collection component has optional `gridColumns` (number of columns on wide viewports) and `gridMaxRows` (cap on visible rows; rows otherwise inferred from item count).
- GraphQL schema and codegen updated; no hand-edits in `packages/graphql`.

## Acceptance criteria

- [ ] Optional `gridColumns` and `gridMaxRows` (integers) added to media-collection component.
- [ ] `apps/cms/schema.graphql` and codegen reflect the new fields.
- [ ] CI passes; PR merged after review.

## Possible solution(s)

1. Add `gridColumns` and `gridMaxRows` (type integer, required false) to `apps/cms/src/components/sections/media-collection.json`. Strapi build + dev for schema; run `pnpm codegen`.

## References

- Epic #120
- .github/experience-schema-epic-plan.md (sub-issue 3)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
