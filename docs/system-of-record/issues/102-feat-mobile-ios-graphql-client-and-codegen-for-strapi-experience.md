---
artifactType: issue
issueNumber: 102
issueTitle: "feat(mobile-ios): GraphQL client and codegen for Strapi Experience"
issueUrl: "https://github.com/JesusFilm/forge/issues/102"
state: "CLOSED"
closedAt: "2026-02-26T01:35:06Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #102

## Background

Native iOS needs to fetch Experience(s) from Strapi via GraphQL. Web uses Apollo Client and `apps/cms/schema.graphql`. iOS should have platform-owned operations and generated client from the same schema.

## Expected outcome

iOS has a typed GraphQL client (e.g. Apollo iOS) and codegen from `apps/cms/schema.graphql` producing Swift types and operations for Experience and section types. ContentClient (or equivalent) adapter with configurable endpoint and auth.

## Acceptance criteria

- [ ] Codegen consumes `apps/cms/schema.graphql`; output in `mobile/ios` (platform-owned).
- [ ] Generated types for Experience and ExperienceSectionsDynamicZone (MediaCollection, PromoBanner, InfoBlocks, CTA).
- [ ] At least one query (e.g. experiences by slug + locale or homepage) implemented and callable.
- [ ] ContentClient/adapter with endpoint (dev/stage/prod) and bearer token support.

## Possible solution(s)

1. Apollo iOS with schema and operations in mobile/ios; codegen script or plugin.
2. Mirror web query intent (experience(slug, locale), homepage) without sharing operation files.

## References

- Parent: #100
- Depends on: #101
- apps/cms/schema.graphql, apps/web/src/lib/content.ts

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
