---
artifactType: issue
issueNumber: 311
issueTitle: "feat(mobile-expo): RelatedQuestionsRenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/311"
state: "CLOSED"
closedAt: "2026-03-10T23:23:29Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #311

## Background

The `RelatedQuestions` section type displays expandable/collapsible Q&A items — used for FAQ-style content like "Why is Easter the most important Christian holiday?" on the Easter page. This issue implements the React Native renderer.

## Expected outcome

- A `RelatedQuestionsRenderer` component that displays a heading and a list of expandable questions.
- Accepts typed props from the data layer (RelatedQuestions model from #304).

## Acceptance criteria

- [ ] Renders `heading` text above the questions list.
- [ ] Renders each item from the `questions` array as an expandable/collapsible accordion.
- [ ] Each item shows `question` text; tapping expands to reveal `answer` text.
- [ ] Only one question expanded at a time (or configurable).
- [ ] Handles empty questions array gracefully.
- [ ] Replaces the RelatedQuestions stub in SectionDispatcher.
- [ ] Accessible (expand/collapse state announced, tap targets).

## Possible solution(s)

1. Heading Text + list of Pressable rows that toggle answer visibility with LayoutAnimation or Animated.
2. Chevron or +/- icon to indicate expand state.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsRelatedQuestions` — heading, sectionKey, questions[] → `ComponentSectionsRelatedQuestionItem` (question, answer)
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — "Related Questions" and Easter dates accordion sections

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
