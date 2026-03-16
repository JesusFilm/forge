---
artifactType: plan
sourceIssueNumber: 156
sourceIssueTitle: "feat(web): add RelatedQuestions component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/156"
linkedPrs: []
---

# Plan Artifact: #156

## Objective

- A RelatedQuestions component in `apps/web` that consumes RelatedQuestions block data and renders heading + repeatable Q&A items (accordion or list, per design).

## Planned approach

1. Add `apps/web/src/components/sections/RelatedQuestions.tsx`; render as accordion (expand/collapse) or static list based on design.
2. Reuse shared accordion or disclosure component if available; keep content driven by CMS data.

## Validation

- [ ] RelatedQuestions component implemented and wired to API/GraphQL shape.
- [ ] Renders heading and repeatable question/answer items; accessible (e.g. expandable sections with keyboard support).
- [ ] Styled per design system; integrated into dynamic zone or section rendering.

## Source links

- Issue: [#156](https://github.com/JesusFilm/forge/issues/156)
- PRs:
- None
