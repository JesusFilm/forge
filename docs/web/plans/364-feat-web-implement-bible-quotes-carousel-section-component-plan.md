---
artifactType: plan
sourceIssueNumber: 364
sourceIssueTitle: "feat(web): implement Bible Quotes Carousel section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/364"
linkedPrs: []
scope: "web"
---

# Plan Artifact: #364

## Objective

A fully functional BibleQuotesCarousel section component that:

- Displays a header row with title and share button
- Renders each bible quote as a card with background image, reference label, and quote text
- Supports a free resource card (last item with CTA button)
- Horizontally scrollable carousel using shadcn/ui Carousel (Embla-based) — updated from initial CSS scroll-snap plan per user request for better drag, snap, and responsive behavior
- Includes seed data so the component is testable locally

## Planned approach

1. Extend Strapi component JSON + regenerate schema → update fragment → build React components → update seed

## Validation

- [x] CMS `bible-quote-item` component extended with `imageUrl` (String) and `backgroundColor` (String) fields
- [x] `schema.graphql` updated to reflect new fields
- [x] GraphQL fragment updated to fetch all quote fields (`quotes`, `reference`, `text`, `attribution`, `imageUrl`, `backgroundColor`, `ctaLabel`, `ctaLink`)
- [x] BibleQuotesCarousel component renders carousel of BibleQuote cards
- [x] BibleQuote sub-component renders card with background image, gradient overlay, reference label, and quote text
- [x] Free resource card (item with ctaLabel/ctaLink) renders CTA button
- [x] Header shows title and share button
- [x] Seed script includes bible quotes carousel block with sample data
- [x] Carousel uses shadcn/ui Carousel (Embla) for drag, snap, and responsive behavior

## Source links

- Issue: [#364](https://github.com/JesusFilm/forge/issues/364)
- PRs:
- None
