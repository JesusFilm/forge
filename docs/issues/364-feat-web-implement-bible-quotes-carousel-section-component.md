---
artifactType: issue
issueNumber: 364
issueTitle: "feat(web): implement Bible Quotes Carousel section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/364"
state: "CLOSED"
closedAt: "2026-03-11T19:25:40Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #364

## Background

The BibleQuotesCarousel component exists as a stub in `apps/web/src/components/sections/BibleQuotesCarousel.tsx` — it currently only renders a heading. The CMS schema already defines `ComponentSectionsBibleQuotesCarousel` with `quotes` (repeatable `BibleQuoteItem` component), but the schema lacks fields for external image URLs and card background colors. The component needs to be fully implemented as a horizontally scrollable card carousel matching the design reference.

## Expected outcome

A fully functional BibleQuotesCarousel section component that:

- Displays a header row with title and share button
- Renders each bible quote as a card with background image, reference label, and quote text
- Supports a free resource card (last item with CTA button)
- Horizontally scrollable carousel using shadcn/ui Carousel (Embla-based) — updated from initial CSS scroll-snap plan per user request for better drag, snap, and responsive behavior
- Includes seed data so the component is testable locally

## Acceptance criteria

- [x] CMS `bible-quote-item` component extended with `imageUrl` (String) and `backgroundColor` (String) fields
- [x] `schema.graphql` updated to reflect new fields
- [x] GraphQL fragment updated to fetch all quote fields (`quotes`, `reference`, `text`, `attribution`, `imageUrl`, `backgroundColor`, `ctaLabel`, `ctaLink`)
- [x] BibleQuotesCarousel component renders carousel of BibleQuote cards
- [x] BibleQuote sub-component renders card with background image, gradient overlay, reference label, and quote text
- [x] Free resource card (item with ctaLabel/ctaLink) renders CTA button
- [x] Header shows title and share button
- [x] Seed script includes bible quotes carousel block with sample data
- [x] Carousel uses shadcn/ui Carousel (Embla) for drag, snap, and responsive behavior

## Possible solution(s)

1. Extend Strapi component JSON + regenerate schema → update fragment → build React components → update seed

## References

- Existing stub: `apps/web/src/components/sections/BibleQuotesCarousel.tsx`
- CMS component: `apps/cms/src/components/sections/bible-quote-item.json`
- Seed script: `apps/cms/scripts/seed-easter.cjs`
- Epic: #176

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
