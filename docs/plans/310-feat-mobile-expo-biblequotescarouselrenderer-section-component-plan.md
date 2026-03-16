---
artifactType: plan
sourceIssueNumber: 310
sourceIssueTitle: "feat(mobile-expo): BibleQuotesCarouselRenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/310"
linkedPrs: []
---

# Plan Artifact: #310

## Objective

- A `BibleQuotesCarouselRenderer` component that displays a heading and scrollable quote cards.
- Accepts typed props from the data layer (BibleQuotesCarousel model from #304).

## Planned approach

1. Heading Text + horizontal FlatList/ScrollView of card Views.
2. Each card: background Image (if present), overlaid text/reference/attribution, optional CTA Pressable.

## Validation

- [ ] Renders `heading` text above the carousel.
- [ ] Renders a horizontally scrollable list of quote cards from the `quotes` array.
- [ ] Each quote card displays: `text`, `reference`, `attribution` (optional), `backgroundImage` (optional).
- [ ] Optional `ctaLabel` and `ctaLink` per quote card rendered as a tappable element.
- [ ] Handles empty quotes array gracefully.
- [ ] Replaces the BibleQuotesCarousel stub in SectionDispatcher.
- [ ] Accessible (scroll hints, card labels).

## Source links

- Issue: [#310](https://github.com/JesusFilm/forge/issues/310)
- PRs:
- None
