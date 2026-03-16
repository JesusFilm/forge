---
artifactType: issue
issueNumber: 351
issueTitle: "feat(web): add related questions accordion component"
issueUrl: "https://github.com/JesusFilm/forge/issues/351"
state: "CLOSED"
closedAt: "2026-03-11T01:09:36Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #351

## Background

The CMS already has `sections.related-questions` and `sections.related-question-item` component schemas defined, and `sections.related-questions` is included in the Experience `blocks` dynamiczone. However, the web app has no GraphQL fragment, no React component, no query support, and no seed data for this section type.

## Expected outcome

A fully functional Related Questions accordion section renders on the Easter experience page, pulling question/answer data from the CMS and displaying it in a collapsible accordion UI built with shadcn/ui.

## Acceptance criteria

- [ ] CMS `related-question-item` answer field changed from `text` to `richtext`
- [ ] shadcn/ui initialised in `apps/web` with Accordion component installed
- [ ] `relatedQuestionsFragment` GraphQL fragment created and wired into `GET_WATCH_EXPERIENCE`
- [ ] `RelatedQuestions` React component renders accordion with markdown answers
- [ ] Component registered in `ExperienceSectionRenderer` and `SectionContentRenderer`
- [ ] GraphQL types regenerated
- [ ] Seed script updated with 3 related question/answer pairs for Easter experience

## Possible solution(s)

1. Change CMS answer field to richtext, set up shadcn/ui, create fragment + component + renderers, update seed script (as detailed in plan)

## References

- Existing CMS schemas: `apps/cms/src/components/sections/related-questions.json`, `related-question-item.json`
- Seed script: `apps/cms/scripts/seed-easter.cjs`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
