---
artifactType: plan
sourceIssueNumber: 132
sourceIssueTitle: "feat(cms): add widthPercent to section components"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/132"
linkedPrs: []
---

# Plan Artifact: #132

## Objective

- All four section components (media-collection, promo-banner, info-blocks, cta) have an optional `widthPercent` (integer 1–100).
- Omitted or 100 = full width. When `widthPercent` < 100%, the client treats the section as sharing a row with the next; next section uses its `widthPercent` if set, else remainder.
- GraphQL schema and codegen updated; no hand-edits in `packages/graphql`.

## Planned approach

1. Add a single `widthPercent` attribute (type integer, min 1, max 100, required false) to each of the four section component JSON schemas under `apps/cms/src/components/sections/`. Strapi build regenerates `schema.graphql`; run `pnpm codegen` for the client.

## Validation

- [ ] Optional `widthPercent` (integer, 1–100) added to: media-collection, promo-banner, info-blocks, cta.
- [ ] `apps/cms/schema.graphql` and codegen reflect the new field on section types.
- [ ] Compiler rule documented: when `widthPercent` < 100%, render next section side-by-side (width = its `widthPercent` or remainder).
- [ ] CI passes; PR merged after review.

## Source links

- Issue: [#132](https://github.com/JesusFilm/forge/issues/132)
- PRs:
- None
