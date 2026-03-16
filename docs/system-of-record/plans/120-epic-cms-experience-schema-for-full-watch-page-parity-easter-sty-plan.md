---
artifactType: plan
sourceIssueNumber: 120
sourceIssueTitle: "epic(cms): Experience schema for full watch-page parity (Easter-style)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/120"
linkedPrs: []
---

# Plan Artifact: #120

## Objective

- Strapi schema and GraphQL allow modeling the Easter reference page end-to-end.
- Experience supports: page title and meta description; optional `widthPercent` per section (compiler infers side-by-side pairing when < 100%); grid columns/max rows for collections; rich content on media items (description, related questions, Bible quotes, resources); repeatable CTA links; optional promo image; optional InfoBlock icon.
- Codegen and at least one consumer (web) updated for new fields. No hand-edits to generated GraphQL types.
- All work tracked in sub-issues linked below; repo workflow (issue first, branch, PR, conventional commits) applied.

## Planned approach

1. **Layout:** Single optional field `widthPercent` (1–100) on each section component; client infers row pairing from order and widths (no rowId).
2. **Grid:** Optional `gridColumns` and `gridMaxRows` on MediaCollection only.
3. **Rich content:** New repeatable components (e.g. bible-quote, related-resource) and fields on MediaCollectionItem; Video.description for default copy.

## Validation

- [ ] All sub-issues created and linked (dependency order below updated with issue numbers).
- [ ] Experience content type has `title`, `metaDescription`.
- [ ] All section components have optional `widthPercent`; compiler rule documented (when < 100%, fit next section beside it).
- [ ] MediaCollection has optional `gridColumns`, `gridMaxRows`.
- [ ] Video has optional `description`; MediaCollectionItem has rich content; InfoBlock icon optional; CTA has repeatable links; PromoBanner has optional image; MediaCollection has optional `ctaLabel`.
- [ ] GraphQL regenerated; web (and optional mobile) fragments and types updated; conventions documented.

## Source links

- Issue: [#120](https://github.com/JesusFilm/forge/issues/120)
- PRs:
- None
