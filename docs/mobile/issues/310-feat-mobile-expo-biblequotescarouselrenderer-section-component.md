---
artifactType: issue
issueNumber: 310
issueTitle: "feat(mobile-expo): BibleQuotesCarouselRenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/310"
state: "CLOSED"
closedAt: "2026-03-10T23:06:15Z"
labels: []
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #310

## Background

The `BibleQuotesCarousel` section type displays a horizontally scrollable set of scripture quote cards with attribution and optional background images (e.g. Apostle Paul quotes on the Easter page). This issue implements the React Native renderer.

## Expected outcome

- A `BibleQuotesCarouselRenderer` component that displays a heading and scrollable quote cards.
- Accepts typed props from the data layer (BibleQuotesCarousel model from #304).

## Acceptance criteria

- [ ] Renders `heading` text above the carousel.
- [ ] Renders a horizontally scrollable list of quote cards from the `quotes` array.
- [ ] Each quote card displays: `text`, `reference`, `attribution` (optional), `backgroundImage` (optional).
- [ ] Optional `ctaLabel` and `ctaLink` per quote card rendered as a tappable element.
- [ ] Handles empty quotes array gracefully.
- [ ] Replaces the BibleQuotesCarousel stub in SectionDispatcher.
- [ ] Accessible (scroll hints, card labels).

## Possible solution(s)

1. Heading Text + horizontal FlatList/ScrollView of card Views.
2. Each card: background Image (if present), overlaid text/reference/attribution, optional CTA Pressable.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsBibleQuotesCarousel` — heading, sectionKey, quotes[] → `ComponentSectionsBibleQuoteItem` (text, reference, attribution, backgroundImage, ctaLabel, ctaLink)
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — Bible quotes carousel sections

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
