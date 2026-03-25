---
date: 2026-03-25
topic: mobile-navigation-carousel
---

# Mobile Navigation Carousel

## Problem Frame

The Easter experience page includes a navigation carousel in the CMS data model and the web app, but the mobile app does not yet render it. Users on mobile cannot quick-jump to sections of the experience page. The carousel data is already seeded and served via GraphQL — the mobile app just needs a renderer and the scroll-to-section wiring.

## Requirements

- R1. Render a horizontal scrollable carousel of navigation cards from the `ComponentSectionsNavigationCarousel` GraphQL data.
- R2. Each card displays: background image (`imageUrl`), title, category label, and background color (`backgroundColor`) as fallback/overlay.
- R3. Tapping a card smooth-scrolls the page to the section whose `sectionKey` matches the card's `contentId`.
- R4. The carousel is an inline section — it scrolls with the rest of the content (not sticky/pinned).
- R5. Sections register their `sectionKey` and Y-offset with `SectionNavContext` so the carousel (and future navigation features) can scroll to them.
- R6. Scroll target is the top of the screen (no hero offset adjustment).
- R7. If a `contentId` has no matching section, the tap does nothing. Log a console warning in development builds only.

## Success Criteria

- Tapping any carousel card scrolls to the correct section on the Easter experience page.
- Carousel visually matches the existing web implementation (image cards with category + title overlay).
- No regressions to existing section rendering or scroll behavior.

## Scope Boundaries

- No active-state indicator (highlighting which section is currently in view) — can be added later.
- No sticky/pinned behavior.
- No new CMS content type changes — the data model already exists.
- No changes to `packages/graphql` unless the mobile query is missing navigation carousel fields.

## Key Decisions

- **Inline carousel**: Matches web behavior; simpler implementation, no z-index or layout complexity.
- **Reuse existing patterns**: Follow `BibleQuotesCarouselRenderer` for horizontal scroll/snap, and implement the stubbed `SectionNavContext` for scroll-to-section.

## Dependencies / Assumptions

- The GraphQL query for experiences already includes (or can include) `ComponentSectionsNavigationCarousel` fields.
- `SectionNavContext` noop stubs are ready to be implemented with real logic.
- The parent scroll container (likely `ScrollView` or `Animated.ScrollView` in `FixedHeroLayout`) supports `scrollTo` for programmatic scrolling.

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Does `FixedHeroLayout`'s scroll container expose a ref that `SectionNavContext` can call `scrollTo` on? If not, what's the cleanest way to wire it?
- [Affects R1][Needs research] Does the current mobile GraphQL query already request navigation carousel fields, or does the query need updating?
- [Affects R5][Technical] Should section Y-offsets be measured via `onLayout` on each section wrapper, or is there a better approach given the fixed-hero scroll architecture?

## Next Steps

-> `/ce:plan` for structured implementation planning
