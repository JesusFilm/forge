---
artifactType: plan
sourceIssueNumber: 311
sourceIssueTitle: "feat(mobile-expo): RelatedQuestionsRenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/311"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #311

## Objective

- A `RelatedQuestionsRenderer` component that displays a heading and a list of expandable questions.
- Accepts typed props from the data layer (RelatedQuestions model from #304).

## Planned approach

1. Heading Text + list of Pressable rows that toggle answer visibility with LayoutAnimation or Animated.
2. Chevron or +/- icon to indicate expand state.

## Validation

- [ ] Renders `heading` text above the questions list.
- [ ] Renders each item from the `questions` array as an expandable/collapsible accordion.
- [ ] Each item shows `question` text; tapping expands to reveal `answer` text.
- [ ] Only one question expanded at a time (or configurable).
- [ ] Handles empty questions array gracefully.
- [ ] Replaces the RelatedQuestions stub in SectionDispatcher.
- [ ] Accessible (expand/collapse state announced, tap targets).

## Source links

- Issue: [#311](https://github.com/JesusFilm/forge/issues/311)
- PRs:
- None
