---
artifactType: issue
issueNumber: 157
issueTitle: "feat(web): add BibleQuotesCarousel component"
issueUrl: "https://github.com/JesusFilm/forge/issues/157"
state: "CLOSED"
closedAt: "2026-03-09T02:31:53Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #157

## Background

The CMS will expose BibleQuotesCarousel blocks (see feat(cms) schema issue). The web app needs a BibleQuotesCarousel component that renders a carousel of Bible quotes (reference + text) with navigation and optional heading.

## Expected outcome

- A BibleQuotesCarousel component in `apps/web` that consumes carousel data and renders quotes in a carousel (swipe/slider or scroll) with reference and text, accessible and responsive.

## Acceptance criteria

- [ ] BibleQuotesCarousel component implemented and wired to API/GraphQL shape.
- [ ] Renders repeatable quotes (reference + text); carousel behavior (prev/next or scroll) per design.
- [ ] Accessible (keyboard, ARIA, reduced motion considered); responsive.
- [ ] Integrated into dynamic zone or section rendering.

## Possible solution(s)

1. Add `apps/web/src/components/sections/BibleQuotesCarousel.tsx`; use a shared carousel/slider primitive or library; map `quotes` to slides.
2. Reuse existing carousel component if one exists; ensure styling and a11y align with design system.

## References

- Resolves/Implements schema: #147 (feat(cms): add schema for BibleQuotesCarousel component)
- `apps/web` component structure

- Parent: #176 Epic B (Web)
- Related (CMS schema): #147

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
