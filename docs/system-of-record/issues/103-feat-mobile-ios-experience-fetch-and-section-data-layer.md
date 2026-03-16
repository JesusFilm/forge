---
artifactType: issue
issueNumber: 103
issueTitle: "feat(mobile-ios): Experience fetch and section data layer"
issueUrl: "https://github.com/JesusFilm/forge/issues/103"
state: "CLOSED"
closedAt: "2026-02-26T03:15:17Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #103

## Background

The app needs a data layer that calls the GraphQL client, maps Experience/sections from the API response, and exposes them to ViewModels for server-driven rendering.

## Expected outcome

A clear data layer (e.g. repository or service) that fetches Experience(s) by slug and locale, maps GraphQL response to section models, and supports error and loading states. No UI; consumed by section renderers and watch home.

## Acceptance criteria

- [ ] Fetch Experience(s) via GraphQL client (from sub-issue #102).
- [ ] Section models/types for MediaCollection, PromoBanner, InfoBlocks, CTA aligned with schema.
- [ ] Loading and error handling; optional caching policy documented.
- [ ] Testable (protocol/injection) for unit tests.

## Possible solution(s)

1. ExperienceRepository with async fetch(slug:locale:) returning Result or async throws; section enum or structs per type.
2. Map API response to view-facing section models in one place so section renderers stay dumb.

## References

- Parent: #100
- Depends on: #102

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
