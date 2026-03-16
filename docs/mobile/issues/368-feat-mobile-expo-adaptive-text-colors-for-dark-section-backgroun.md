---
artifactType: issue
issueNumber: 368
issueTitle: "feat(mobile-expo): adaptive text colors for dark section backgrounds"
issueUrl: "https://github.com/JesusFilm/forge/issues/368"
state: "CLOSED"
closedAt: "2026-03-11T17:34:37Z"
labels: ["enhancement", "feat"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #368

## Background

Not provided in source issue.

## Expected outcome

Not provided in source issue.

## Acceptance criteria

- [ ] `SectionWrapperRenderer` passes a `colorScheme: 'light' | 'dark'` (or similar) prop/context to child renderers based on `backgroundColor`
- [ ] `dark` and `primary` backgrounds → light text scheme (white headings, light body text)
- [ ] `default` and `light` backgrounds → dark text scheme (current behavior)
- [ ] All child renderers (`TextRenderer`, `BibleQuotesCarouselRenderer`, `RelatedQuestionsRenderer`, `CTARenderer`, `MediaCollectionRenderer`) respect the color scheme
- [ ] Unit tests updated

## Possible solution(s)

Not provided in source issue.

## References

Not provided in source issue.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
