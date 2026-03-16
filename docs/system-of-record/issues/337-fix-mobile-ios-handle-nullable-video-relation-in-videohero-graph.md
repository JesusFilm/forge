---
artifactType: issue
issueNumber: 337
issueTitle: "fix(mobile-ios): handle nullable video relation in VideoHero GraphQL fragment"
issueUrl: "https://github.com/JesusFilm/forge/issues/337"
state: "CLOSED"
closedAt: "2026-03-10T21:52:37Z"
labels: ["fix", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #337

## Background

The `ComponentSectionsVideoHero` type declares `video: Video!` (non-nullable) in the GraphQL schema. However, Strapi's GraphQL plugin does not automatically deep-populate relations inside dynamic zone components. When the iOS app queries a VideoHero block, the `video` relation returns `null`, violating the non-nullable constraint and producing:

```
Cannot return null for non-nullable field ComponentSectionsVideoHero.video.
```

This causes the entire VideoHero block to be dropped from the response, so the app shows "no VideoHero found."

## Expected outcome

- The schema declares `video` as nullable (`Video` instead of `Video!`) so the query does not error out when Strapi fails to populate the relation.
- The iOS fragment, generated code, and mapper handle the optional `video` gracefully.
- The VideoHeroView falls back to streaming-only mode when `video` is nil.

## Acceptance criteria

- [ ] `schema.graphql`: `video` field on `ComponentSectionsVideoHero` is nullable
- [ ] iOS generated GraphQL code regenerated to reflect nullable `video`
- [ ] `SectionMappers.swift` handles optional `heroVideo`
- [ ] `VideoHeroView` renders correctly when `video` is nil (uses streamingUrl only)
- [ ] `xcodebuild` clean build passes
- [ ] No lint errors introduced

## Possible solution(s)

1. Change `video: Video!` → `video: Video` in `apps/cms/schema.graphql`.
2. Regenerate the iOS Apollo code (or manually update the generated fragment).
3. Update `SectionMappers.swift` to handle `frag.heroVideo` as optional.
4. Long-term: add a Strapi GraphQL middleware to ensure deep population of relations in dynamic zones.

## References

- PR #336 (feat: VideoHero section renderer)
- CMS component: `apps/cms/src/components/sections/video-hero.json`
- Schema: `ComponentSectionsVideoHero` in `apps/cms/schema.graphql`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
