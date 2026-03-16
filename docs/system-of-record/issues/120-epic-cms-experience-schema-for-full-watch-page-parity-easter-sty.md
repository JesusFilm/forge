---
artifactType: issue
issueNumber: 120
issueTitle: "epic(cms): Experience schema for full watch-page parity (Easter-style)"
issueUrl: "https://github.com/JesusFilm/forge/issues/120"
state: "CLOSED"
closedAt: "2026-03-08T22:06:24Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #120

## Background

Parent epic to extend the Strapi CMS **Experience** schema so a single JSONified Experience document can drive full watch-page experiences (e.g. [Easter](https://www.jesusfilm.org/watch/easter.html/english.html)). Apps (web, mobile) fetch one payload and render it; layout supports side-by-side blocks (viewport share) and configurable grid columns/rows. Schema must stay minimal—only what cannot be inferred by the client.

**Context:**

- **Goal:** One Experience = one page. All fields, subcomponents, and relations needed for clients to parse and build the experience on their platforms.
- **Reference:** Jesus Film Easter page and screenshots (two-column narrative + info card; related questions; video Bible collection grid).
- **CMS:** Strapi in `apps/cms`; schema at `apps/cms/schema.graphql`. Existing section types: MediaCollection, PromoBanner, InfoBlocks, CTA.

## Expected outcome

- Strapi schema and GraphQL allow modeling the Easter reference page end-to-end.
- Experience supports: page title and meta description; optional `widthPercent` per section (compiler infers side-by-side pairing when < 100%); grid columns/max rows for collections; rich content on media items (description, related questions, Bible quotes, resources); repeatable CTA links; optional promo image; optional InfoBlock icon.
- Codegen and at least one consumer (web) updated for new fields. No hand-edits to generated GraphQL types.
- All work tracked in sub-issues linked below; repo workflow (issue first, branch, PR, conventional commits) applied.

## Acceptance criteria

- [ ] All sub-issues created and linked (dependency order below updated with issue numbers).
- [ ] Experience content type has `title`, `metaDescription`.
- [ ] All section components have optional `widthPercent`; compiler rule documented (when < 100%, fit next section beside it).
- [ ] MediaCollection has optional `gridColumns`, `gridMaxRows`.
- [ ] Video has optional `description`; MediaCollectionItem has rich content; InfoBlock icon optional; CTA has repeatable links; PromoBanner has optional image; MediaCollection has optional `ctaLabel`.
- [ ] GraphQL regenerated; web (and optional mobile) fragments and types updated; conventions documented.

## Possible solution(s)

1. **Layout:** Single optional field `widthPercent` (1–100) on each section component; client infers row pairing from order and widths (no rowId).
2. **Grid:** Optional `gridColumns` and `gridMaxRows` on MediaCollection only.
3. **Rich content:** New repeatable components (e.g. bible-quote, related-resource) and fields on MediaCollectionItem; Video.description for default copy.

## References

- [.github/experience-schema-epic-plan.md](.github/experience-schema-epic-plan.md)
- [apps/cms/schema.graphql](apps/cms/schema.graphql)
- [apps/web/src/lib/content.ts](apps/web/src/lib/content.ts)

---

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
