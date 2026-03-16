---
artifactType: issue
issueNumber: 156
issueTitle: "feat(web): add RelatedQuestions component"
issueUrl: "https://github.com/JesusFilm/forge/issues/156"
state: "CLOSED"
closedAt: "2026-03-11T02:00:00Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #156

## Background

The CMS will expose RelatedQuestions blocks (see feat(cms) schema issue). The web app needs a RelatedQuestions component that renders a list or accordion of question/answer pairs (e.g. for FAQ or related Q&A).

## Expected outcome

- A RelatedQuestions component in `apps/web` that consumes RelatedQuestions block data and renders heading + repeatable Q&A items (accordion or list, per design).

## Acceptance criteria

- [ ] RelatedQuestions component implemented and wired to API/GraphQL shape.
- [ ] Renders heading and repeatable question/answer items; accessible (e.g. expandable sections with keyboard support).
- [ ] Styled per design system; integrated into dynamic zone or section rendering.

## Possible solution(s)

1. Add `apps/web/src/components/sections/RelatedQuestions.tsx`; render as accordion (expand/collapse) or static list based on design.
2. Reuse shared accordion or disclosure component if available; keep content driven by CMS data.

## References

- Resolves/Implements schema: #146 (feat(cms): add schema for RelatedQuestions component)
- `apps/web` component structure

- Parent: #176 Epic B (Web)
- Related (CMS schema): #146

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
