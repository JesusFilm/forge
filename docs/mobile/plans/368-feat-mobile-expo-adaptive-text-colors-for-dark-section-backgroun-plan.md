---
artifactType: plan
sourceId: 368
sourceTitle: "feat(mobile-expo): adaptive text colors for dark section backgrounds"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: "feat(mobile-expo): adaptive text colors for dark section backgrounds"

## Objective

Not provided in source content.

## Planned approach

Not provided in source content.

## Validation

- [ ] `SectionWrapperRenderer` passes a `colorScheme: 'light' | 'dark'` (or similar) prop/context to child renderers based on `backgroundColor`
- [ ] `dark` and `primary` backgrounds → light text scheme (white headings, light body text)
- [ ] `default` and `light` backgrounds → dark text scheme (current behavior)
- [ ] All child renderers (`TextRenderer`, `BibleQuotesCarouselRenderer`, `RelatedQuestionsRenderer`, `CTARenderer`, `MediaCollectionRenderer`) respect the color scheme
- [ ] Unit tests updated

## References

Not provided in source content.

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
