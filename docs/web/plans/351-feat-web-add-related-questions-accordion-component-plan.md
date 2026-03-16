---
artifactType: plan
sourceIssueNumber: 351
sourceIssueTitle: "feat(web): add related questions accordion component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/351"
linkedPrs: []
scope: "web"
---

# Plan Artifact: #351

## Objective

A fully functional Related Questions accordion section renders on the Easter experience page, pulling question/answer data from the CMS and displaying it in a collapsible accordion UI built with shadcn/ui.

## Planned approach

1. Change CMS answer field to richtext, set up shadcn/ui, create fragment + component + renderers, update seed script (as detailed in plan)

## Validation

- [ ] CMS `related-question-item` answer field changed from `text` to `richtext`
- [ ] shadcn/ui initialised in `apps/web` with Accordion component installed
- [ ] `relatedQuestionsFragment` GraphQL fragment created and wired into `GET_WATCH_EXPERIENCE`
- [ ] `RelatedQuestions` React component renders accordion with markdown answers
- [ ] Component registered in `ExperienceSectionRenderer` and `SectionContentRenderer`
- [ ] GraphQL types regenerated
- [ ] Seed script updated with 3 related question/answer pairs for Easter experience

## Source links

- Issue: [#351](https://github.com/JesusFilm/forge/issues/351)
- PRs:
- None
