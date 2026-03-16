---
artifactType: plan
sourceIssueNumber: 154
sourceIssueTitle: "feat(web): add Text component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/154"
linkedPrs: []
---

# Plan Artifact: #154

## Objective

- A Text component in `apps/web` that consumes Text block data and renders content with correct semantics and styling (including any richtext blocks if used).

## Planned approach

1. Add `apps/web/src/components/shared/Text.tsx` or `sections/Text.tsx`; use Strapi richtext renderer or map blocks to React components if blocks are used.
2. Reuse existing typography/richtext components; ensure block types (heading, paragraph, list) are handled.

## Validation

- [ ] Text component implemented and wired to API/GraphQL shape.
- [ ] Renders content with appropriate HTML semantics (headings, paragraphs, lists).
- [ ] Supports optional heading and variant from schema; accessible and styled per design system.
- [ ] Integrated into dynamic zone or section rendering.

## Source links

- Issue: [#154](https://github.com/JesusFilm/forge/issues/154)
- PRs:
- None
