---
artifactType: plan
sourceIssueNumber: 102
sourceIssueTitle: "feat(mobile-ios): GraphQL client and codegen for Strapi Experience"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/102"
linkedPrs: []
---

# Plan Artifact: #102

## Objective

iOS has a typed GraphQL client (e.g. Apollo iOS) and codegen from `apps/cms/schema.graphql` producing Swift types and operations for Experience and section types. ContentClient (or equivalent) adapter with configurable endpoint and auth.

## Planned approach

1. Apollo iOS with schema and operations in mobile/ios; codegen script or plugin.
2. Mirror web query intent (experience(slug, locale), homepage) without sharing operation files.

## Validation

- [ ] Codegen consumes `apps/cms/schema.graphql`; output in `mobile/ios` (platform-owned).
- [ ] Generated types for Experience and ExperienceSectionsDynamicZone (MediaCollection, PromoBanner, InfoBlocks, CTA).
- [ ] At least one query (e.g. experiences by slug + locale or homepage) implemented and callable.
- [ ] ContentClient/adapter with endpoint (dev/stage/prod) and bearer token support.

## Source links

- Issue: [#102](https://github.com/JesusFilm/forge/issues/102)
- PRs:
- None
