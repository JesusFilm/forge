---
artifactType: plan
sourceIssueNumber: 103
sourceIssueTitle: "feat(mobile-ios): Experience fetch and section data layer"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/103"
linkedPrs: []
---

# Plan Artifact: #103

## Objective

A clear data layer (e.g. repository or service) that fetches Experience(s) by slug and locale, maps GraphQL response to section models, and supports error and loading states. No UI; consumed by section renderers and watch home.

## Planned approach

1. ExperienceRepository with async fetch(slug:locale:) returning Result or async throws; section enum or structs per type.
2. Map API response to view-facing section models in one place so section renderers stay dumb.

## Validation

- [ ] Fetch Experience(s) via GraphQL client (from sub-issue #102).
- [ ] Section models/types for MediaCollection, PromoBanner, InfoBlocks, CTA aligned with schema.
- [ ] Loading and error handling; optional caching policy documented.
- [ ] Testable (protocol/injection) for unit tests.

## Source links

- Issue: [#103](https://github.com/JesusFilm/forge/issues/103)
- PRs:
- None
