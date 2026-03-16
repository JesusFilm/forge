---
artifactType: issue
issueNumber: 442
issueTitle: "feat(web,cms): add quiz-button section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/442"
state: "CLOSED"
closedAt: "2026-03-13T01:46:52Z"
labels: []
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #442

## Background

The experience pages need a quiz button section component that opens a modal with an embedded quiz iframe. The button has a distinctive animated gradient style (orange/amber/red mesh gradient) with a "QUIZ" badge and arrow icon.

## Expected outcome

A fully functional quiz-button component:

- CMS schema (`quiz-button`) with `buttonText` and `iframeSrc` attributes
- Web component rendering the gradient button and opening a dialog with the iframe
- Seed data placing the button as the last block in the first section
- Fragment and renderer wiring

## Acceptance criteria

- [ ] CMS schema `quiz-button.json` exists with `buttonText` (string, required) and `iframeSrc` (string, required)
- [ ] Quiz button is added to the section content dynamic zone
- [ ] Web component renders gradient button matching reference design
- [ ] Clicking button opens modal with iframe using `iframeSrc` from CMS
- [ ] GraphQL fragment created and wired into section fragment
- [ ] Section.tsx SectionContentRenderer handles `ComponentSectionsQuizButton`
- [ ] Seed data places quiz button as last block in first section
- [ ] Mesh gradient animation added to globals.css

## Possible solution(s)

1. Create CMS schema, web component (QuizButton + QuizModal), fragment, and seed data following existing section patterns

## References

- Existing section component patterns in `apps/cms/src/components/sections/`
- Reference design from previous project

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
