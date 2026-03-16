---
artifactType: issue
issueNumber: 290
issueTitle: "feat(mobile-ios): Section renderer – BibleQuotesCarousel"
issueUrl: "https://github.com/JesusFilm/forge/issues/290"
state: "CLOSED"
closedAt: "2026-03-11T02:49:33Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #290

## Background

Experience sections include BibleQuotesCarousel — a horizontal carousel of Scripture quotes with background images and optional CTAs. One of 10 leaf section renderers; can be implemented in parallel with other Tier 1 renderers after #286 (data layer expansion).

## Expected outcome

A SwiftUI view that renders BibleQuotesCarousel section data: optional heading and a horizontally-scrolling carousel of quote cards. Composable at any nesting level.

## Acceptance criteria

- [x] BibleQuotesCarouselView (or equivalent) takes `BibleQuotesCarouselSection` from data layer (#286).
- [x] Displays optional heading above carousel.
- [x] Horizontal scroll of quote cards, each showing: reference, quote text, optional background image, optional attribution.
- [x] CTA button on cards where ctaLabel/ctaLink are present.
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver reads quote text and reference).

## Possible solution(s)

1. `ScrollView(.horizontal)` with card views; `AsyncImage` for background.
2. `TabView` with `.tabViewStyle(.page)` for paged carousel feel.

## References

- Parent: #100
- Depends on: #286 (data layer expansion)
- CMS schema: `apps/cms/src/components/sections/bible-quotes-carousel.json`, `apps/cms/src/components/sections/bible-quote-item.json`
- Fields: `sectionKey`, `heading`, `quotes[]` → `reference` (required), `text` (required), `backgroundImage`, `ctaLabel`, `ctaLink`, `attribution`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
