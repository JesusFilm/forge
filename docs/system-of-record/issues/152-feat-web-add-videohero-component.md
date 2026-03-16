---
artifactType: issue
issueNumber: 152
issueTitle: "feat(web): add VideoHero component"
issueUrl: "https://github.com/JesusFilm/forge/issues/152"
state: "CLOSED"
closedAt: "2026-03-09T22:22:06Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #152

## Background

The CMS will expose VideoHero content via schema (see feat(cms) schema issue). The web app needs a VideoHero component that consumes this data and renders the hero with video, optional heading/copy, and CTAs.

## Expected outcome

- A VideoHero component exists in `apps/web` that reads VideoHero block data (from Strapi/GraphQL) and renders the hero (video, heading, subheading, optional CTA).
- Component is integrated into the page/dynamic zone rendering pipeline.

## Acceptance criteria

- [ ] VideoHero component implemented and wired to GraphQL/API response shape.
- [ ] Handles video asset (and optional fallback/placeholder).
- [ ] Accessible and responsive; optional blur hash or placeholder while loading.
- [ ] Integrated where section/components are rendered (e.g. dynamic zone or layout).

## Possible solution(s)

1. Add `apps/web/src/components/sections/VideoHero.tsx` (or under existing structure); consume component fragment from generated client.
2. Reuse shared `Media` or `Hero` primitives if they exist; keep styling consistent with design system.

## References

- Resolves/Implements schema: #142 (feat(cms): add schema for VideoHero component)
- `apps/web` component structure
- `packages/graphql` generated types

- Parent: #176 Epic B (Web)
- Related (CMS schema): #142

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
