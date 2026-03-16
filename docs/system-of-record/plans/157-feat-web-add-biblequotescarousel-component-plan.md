---
artifactType: plan
sourceIssueNumber: 157
sourceIssueTitle: "feat(web): add BibleQuotesCarousel component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/157"
linkedPrs: []
---

# Plan Artifact: #157

## Objective

- A BibleQuotesCarousel component in `apps/web` that consumes carousel data and renders quotes in a carousel (swipe/slider or scroll) with reference and text, accessible and responsive.

## Planned approach

1. Add `apps/web/src/components/sections/BibleQuotesCarousel.tsx`; use a shared carousel/slider primitive or library; map `quotes` to slides.
2. Reuse existing carousel component if one exists; ensure styling and a11y align with design system.

## Validation

- [ ] BibleQuotesCarousel component implemented and wired to API/GraphQL shape.
- [ ] Renders repeatable quotes (reference + text); carousel behavior (prev/next or scroll) per design.
- [ ] Accessible (keyboard, ARIA, reduced motion considered); responsive.
- [ ] Integrated into dynamic zone or section rendering.

## Source links

- Issue: [#157](https://github.com/JesusFilm/forge/issues/157)
- PRs:
- None
