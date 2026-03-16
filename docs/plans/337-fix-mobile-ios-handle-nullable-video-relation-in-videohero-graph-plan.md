---
artifactType: plan
sourceIssueNumber: 337
sourceIssueTitle: "fix(mobile-ios): handle nullable video relation in VideoHero GraphQL fragment"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/337"
linkedPrs: []
---

# Plan Artifact: #337

## Objective

- The schema declares `video` as nullable (`Video` instead of `Video!`) so the query does not error out when Strapi fails to populate the relation.
- The iOS fragment, generated code, and mapper handle the optional `video` gracefully.
- The VideoHeroView falls back to streaming-only mode when `video` is nil.

## Planned approach

1. Change `video: Video!` → `video: Video` in `apps/cms/schema.graphql`.
2. Regenerate the iOS Apollo code (or manually update the generated fragment).
3. Update `SectionMappers.swift` to handle `frag.heroVideo` as optional.
4. Long-term: add a Strapi GraphQL middleware to ensure deep population of relations in dynamic zones.

## Validation

- [ ] `schema.graphql`: `video` field on `ComponentSectionsVideoHero` is nullable
- [ ] iOS generated GraphQL code regenerated to reflect nullable `video`
- [ ] `SectionMappers.swift` handles optional `heroVideo`
- [ ] `VideoHeroView` renders correctly when `video` is nil (uses streamingUrl only)
- [ ] `xcodebuild` clean build passes
- [ ] No lint errors introduced

## Source links

- Issue: [#337](https://github.com/JesusFilm/forge/issues/337)
- PRs:
- None
