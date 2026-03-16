---
artifactType: issue
issueNumber: 289
issueTitle: "feat(mobile-ios): Section renderer – RelatedQuestions"
issueUrl: "https://github.com/JesusFilm/forge/issues/289"
state: "CLOSED"
closedAt: "2026-03-11T02:12:07Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #289

## Background

Experience sections include RelatedQuestions — an FAQ-style accordion of question/answer pairs. One of 10 leaf section renderers; can be implemented in parallel with other Tier 1 renderers after #286 (data layer expansion).

## Expected outcome

A SwiftUI view that renders RelatedQuestions section data: optional heading and a list of expandable Q&A items. Composable at any nesting level.

## Acceptance criteria

- [x] RelatedQuestionsView (or equivalent) takes `RelatedQuestionsSection` from data layer (#286).
- [x] Displays optional heading.
- [x] Renders questions as expandable/collapsible items (DisclosureGroup or equivalent).
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver for expand/collapse state).

## Possible solution(s)

1. `DisclosureGroup` for each Q&A pair; question as label, answer as content.
2. Custom expandable list with animation.

## References

- Parent: #100
- Depends on: #286 (data layer expansion)
- CMS schema: `apps/cms/src/components/sections/related-questions.json`, `apps/cms/src/components/sections/related-question-item.json`
- Fields: `sectionKey`, `heading`, `questions[]` → `question` (required), `answer` (required)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
