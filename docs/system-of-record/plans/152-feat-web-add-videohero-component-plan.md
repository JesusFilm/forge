---
artifactType: plan
sourceIssueNumber: 152
sourceIssueTitle: "feat(web): add VideoHero component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/152"
linkedPrs: []
---

# Plan Artifact: #152

## Objective

- A VideoHero component exists in `apps/web` that reads VideoHero block data (from Strapi/GraphQL) and renders the hero (video, heading, subheading, optional CTA).
- Component is integrated into the page/dynamic zone rendering pipeline.

## Planned approach

1. Add `apps/web/src/components/sections/VideoHero.tsx` (or under existing structure); consume component fragment from generated client.
2. Reuse shared `Media` or `Hero` primitives if they exist; keep styling consistent with design system.

## Validation

- [ ] VideoHero component implemented and wired to GraphQL/API response shape.
- [ ] Handles video asset (and optional fallback/placeholder).
- [ ] Accessible and responsive; optional blur hash or placeholder while loading.
- [ ] Integrated where section/components are rendered (e.g. dynamic zone or layout).

## Source links

- Issue: [#152](https://github.com/JesusFilm/forge/issues/152)
- PRs:
- None
