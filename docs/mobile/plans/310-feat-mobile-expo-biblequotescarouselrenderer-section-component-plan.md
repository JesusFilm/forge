---
artifactType: plan
sourceId: 310
sourceTitle: "feat(mobile-expo): BibleQuotesCarouselRenderer section component"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: "feat(mobile-expo): BibleQuotesCarouselRenderer section component"

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

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsBibleQuotesCarousel` — heading, sectionKey, quotes[] → `ComponentSectionsBibleQuoteItem` (text, reference, attribution, backgroundImage, ctaLabel, ctaLink)
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — Bible quotes carousel sections

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
