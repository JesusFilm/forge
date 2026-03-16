---
artifactType: plan
sourceIssueNumber: 368
sourceIssueTitle: "feat(mobile-expo): adaptive text colors for dark section backgrounds"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/368"
linkedPrs: []
---

# Plan Artifact: #368

## Objective

Not provided in source issue.

## Planned approach

Not provided in source issue.

## Validation

- [ ] `SectionWrapperRenderer` passes a `colorScheme: 'light' | 'dark'` (or similar) prop/context to child renderers based on `backgroundColor`
- [ ] `dark` and `primary` backgrounds → light text scheme (white headings, light body text)
- [ ] `default` and `light` backgrounds → dark text scheme (current behavior)
- [ ] All child renderers (`TextRenderer`, `BibleQuotesCarouselRenderer`, `RelatedQuestionsRenderer`, `CTARenderer`, `MediaCollectionRenderer`) respect the color scheme
- [ ] Unit tests updated

## Source links

- Issue: [#368](https://github.com/JesusFilm/forge/issues/368)
- PRs:
- None
