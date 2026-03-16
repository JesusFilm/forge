---
artifactType: issue
issueNumber: 391
issueTitle: "feat(graphql): expand watchExperience query for all 10 section types"
issueUrl: "https://github.com/JesusFilm/forge/issues/391"
state: "CLOSED"
closedAt: "2026-03-12T00:08:44Z"
labels: []
linkedPrs: []
scope: "graphql"
---

# Issue Artifact: #391

## Background

The `GET_WATCH_EXPERIENCE` query in `packages/graphql/src/watchExperience.ts` currently only includes fragments for 5 section types (VideoHero, MediaCollection, CTA, PromoBanner, InfoBlocks). The CMS schema was expanded in epic #175 to support all 10 active section types, and the Expo data layer was expanded in #304 to map them — but the shared GQL query was never updated to actually fetch the new types.

As a result, the Expo app (and any other consumer of `@forge/graphql`) receives `__typename`-only responses for Section wrappers, Text, Video, BibleQuotesCarousel, RelatedQuestions, Card, and Container blocks. The Strapi Easter experience has full data for all these types, but the query doesn't request their fields.

## Expected outcome

`GET_WATCH_EXPERIENCE` includes inline fragments (with aliases to avoid field conflicts) for all 10 active section types, including nested `content` in Section wrappers and `slots.content` in Container.

## Acceptance criteria

- [ ] `ComponentSectionsSection` fragment: `id`, `sectionKey`, `backgroundColor`, `blurHash`, `content` (dynamic zone with nested fragments for all leaf types + Container)
- [ ] `ComponentSectionsContainer` fragment: `id`, `sectionKey`, `slots` with `gridSpan` and `content` (dynamic zone with leaf type fragments)
- [ ] `ComponentSectionsText` fragment: `id`, `sectionKey`, `heading`, `headingLevel`, `subtitle`, `contentParagraphs`, `variant`
- [ ] `ComponentSectionsVideo` fragment: `id`, `sectionKey`, `title`, `subtitle`, `streamingUrl`, `media`, `video` (linked entity)
- [ ] `ComponentSectionsBibleQuotesCarousel` fragment: `id`, `sectionKey`, `heading`, `quotes` (text, reference, attribution, backgroundImage, ctaLabel, ctaLink)
- [ ] `ComponentSectionsRelatedQuestions` fragment: `id`, `sectionKey`, `heading`, `questions` (question, answer)
- [ ] `ComponentSectionsCard` fragment: `id`, `sectionKey`, `title`, `description`, `media`, `link`, `variant`
- [ ] Aliases used where field names conflict across types (e.g. `title`, `variant`, `content`, `subtitle`)
- [ ] Codegen regenerated (`pnpm run codegen` in `packages/graphql`)
- [ ] Expo app data layer (`sectionMapper.ts`) still compiles with updated types
- [ ] Lint and typecheck pass

## Possible solution(s)

Add inline fragments to the existing `blocks` selection in `watchExperience.ts`, using aliases consistent with the sectionMapper expectations (e.g. `textHeading: heading`, `carouselHeading: heading`, `sectionContent: content`, `slotContent: content`).

Reference the iOS query (`mobile/ios/GraphQL/Operations/GetWatchExperience.graphql`) and the Expo sectionMapper (`mobile/expo/src/lib/sectionMapper.ts`) for field names and alias conventions.

## References

- `packages/graphql/src/watchExperience.ts` — current query (5 fragments)
- `mobile/expo/src/lib/sectionMapper.ts` — mapper expecting all 10 types
- `mobile/ios/GraphQL/Operations/GetWatchExperience.graphql` — iOS reference query
- `apps/cms/schema.graphql` — CMS schema with all section types
- Epic #175 — CMS schema expansion (done)
- Issue #304 — Expo data layer expansion (done)
- Epic #89 — parent Expo epic

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
