---
artifactType: plan
sourceIssueNumber: 289
sourceIssueTitle: "feat(mobile-ios): Section renderer – RelatedQuestions"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/289"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #289

## Objective

A SwiftUI view that renders RelatedQuestions section data: optional heading and a list of expandable Q&A items. Composable at any nesting level.

## Planned approach

1. `DisclosureGroup` for each Q&A pair; question as label, answer as content.
2. Custom expandable list with animation.

## Validation

- [x] RelatedQuestionsView (or equivalent) takes `RelatedQuestionsSection` from data layer (#286).
- [x] Displays optional heading.
- [x] Renders questions as expandable/collapsible items (DisclosureGroup or equivalent).
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver for expand/collapse state).

## Source links

- Issue: [#289](https://github.com/JesusFilm/forge/issues/289)
- PRs:
- None
