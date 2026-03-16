---
artifactType: plan
sourceIssueNumber: 290
sourceIssueTitle: "feat(mobile-ios): Section renderer – BibleQuotesCarousel"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/290"
linkedPrs: []
---

# Plan Artifact: #290

## Objective

A SwiftUI view that renders BibleQuotesCarousel section data: optional heading and a horizontally-scrolling carousel of quote cards. Composable at any nesting level.

## Planned approach

1. `ScrollView(.horizontal)` with card views; `AsyncImage` for background.
2. `TabView` with `.tabViewStyle(.page)` for paged carousel feel.

## Validation

- [x] BibleQuotesCarouselView (or equivalent) takes `BibleQuotesCarouselSection` from data layer (#286).
- [x] Displays optional heading above carousel.
- [x] Horizontal scroll of quote cards, each showing: reference, quote text, optional background image, optional attribution.
- [x] CTA button on cards where ctaLabel/ctaLink are present.
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver reads quote text and reference).

## Source links

- Issue: [#290](https://github.com/JesusFilm/forge/issues/290)
- PRs:
- None
