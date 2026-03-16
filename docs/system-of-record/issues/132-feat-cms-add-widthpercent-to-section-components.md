---
artifactType: issue
issueNumber: 132
issueTitle: "feat(cms): add widthPercent to section components"
issueUrl: "https://github.com/JesusFilm/forge/issues/132"
state: "CLOSED"
closedAt: "2026-03-01T22:49:23Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #132

## Background

Epic #120 (Experience schema for full watch-page parity) requires side-by-side layout: two blocks in one row with configurable viewport share (e.g. 70% / 30%). Per the epic plan, we add one optional field to every section component so the client can infer layout without explicit grouping.

## Expected outcome

- All four section components (media-collection, promo-banner, info-blocks, cta) have an optional `widthPercent` (integer 1–100).
- Omitted or 100 = full width. When `widthPercent` < 100%, the client treats the section as sharing a row with the next; next section uses its `widthPercent` if set, else remainder.
- GraphQL schema and codegen updated; no hand-edits in `packages/graphql`.

## Acceptance criteria

- [ ] Optional `widthPercent` (integer, 1–100) added to: media-collection, promo-banner, info-blocks, cta.
- [ ] `apps/cms/schema.graphql` and codegen reflect the new field on section types.
- [ ] Compiler rule documented: when `widthPercent` < 100%, render next section side-by-side (width = its `widthPercent` or remainder).
- [ ] CI passes; PR merged after review.

## Possible solution(s)

1. Add a single `widthPercent` attribute (type integer, min 1, max 100, required false) to each of the four section component JSON schemas under `apps/cms/src/components/sections/`. Strapi build regenerates `schema.graphql`; run `pnpm codegen` for the client.

## References

- Epic #120
- .github/experience-schema-epic-plan.md (sections 1 and 2, sub-issue 2)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
