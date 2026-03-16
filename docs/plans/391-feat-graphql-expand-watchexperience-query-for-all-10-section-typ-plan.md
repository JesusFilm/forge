---
artifactType: plan
sourceIssueNumber: 391
sourceIssueTitle: "feat(graphql): expand watchExperience query for all 10 section types"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/391"
linkedPrs: []
---

# Plan Artifact: #391

## Objective

`GET_WATCH_EXPERIENCE` includes inline fragments (with aliases to avoid field conflicts) for all 10 active section types, including nested `content` in Section wrappers and `slots.content` in Container.

## Planned approach

Add inline fragments to the existing `blocks` selection in `watchExperience.ts`, using aliases consistent with the sectionMapper expectations (e.g. `textHeading: heading`, `carouselHeading: heading`, `sectionContent: content`, `slotContent: content`).

Reference the iOS query (`mobile/ios/GraphQL/Operations/GetWatchExperience.graphql`) and the Expo sectionMapper (`mobile/expo/src/lib/sectionMapper.ts`) for field names and alias conventions.

## Validation

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

## Source links

- Issue: [#391](https://github.com/JesusFilm/forge/issues/391)
- PRs:
- None
