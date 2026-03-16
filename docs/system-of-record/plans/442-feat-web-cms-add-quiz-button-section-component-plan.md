---
artifactType: plan
sourceIssueNumber: 442
sourceIssueTitle: "feat(web,cms): add quiz-button section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/442"
linkedPrs: []
---

# Plan Artifact: #442

## Objective

A fully functional quiz-button component:

- CMS schema (`quiz-button`) with `buttonText` and `iframeSrc` attributes
- Web component rendering the gradient button and opening a dialog with the iframe
- Seed data placing the button as the last block in the first section
- Fragment and renderer wiring

## Planned approach

1. Create CMS schema, web component (QuizButton + QuizModal), fragment, and seed data following existing section patterns

## Validation

- [ ] CMS schema `quiz-button.json` exists with `buttonText` (string, required) and `iframeSrc` (string, required)
- [ ] Quiz button is added to the section content dynamic zone
- [ ] Web component renders gradient button matching reference design
- [ ] Clicking button opens modal with iframe using `iframeSrc` from CMS
- [ ] GraphQL fragment created and wired into section fragment
- [ ] Section.tsx SectionContentRenderer handles `ComponentSectionsQuizButton`
- [ ] Seed data places quiz button as last block in first section
- [ ] Mesh gradient animation added to globals.css

## Source links

- Issue: [#442](https://github.com/JesusFilm/forge/issues/442)
- PRs:
- None
