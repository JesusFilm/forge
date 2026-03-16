---
artifactType: plan
sourceIssueNumber: 286
sourceIssueTitle: "feat(mobile-ios): expand data layer for 12-section Experience schema"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/286"
linkedPrs: []
---

# Plan Artifact: #286

## Objective

The iOS data layer (models, GraphQL query, mapping) supports all 12 Experience section types including full 3-level nesting for Container and Section wrapper components, aligned with the current CMS schema (`ExperienceBlocksDynamicZone`).

## Planned approach

Not provided in source issue.

## Validation

- [x] 8 new model structs added (VideoHeroSection, TextSection, ContainerSection, SectionWrapperSection, RelatedQuestionsSection, BibleQuotesCarouselSection, CardSection, VideoSection)
- [x] New `SectionContent` enum for leaf types used inside Container slots and Section content
- [x] `ExperienceSection` enum expanded from 4 to 12 cases, with `container` and `sectionWrapper` for structural types
- [x] `GetWatchExperience.graphql` uses `blocks` field with all 12 inline fragments + named fragments for reuse in nested dynamic zones
- [x] `streamingUrl` field present on both VideoHero and Video section fragments
- [x] Full 3-level nesting: Experience.blocks → Section.content → Container.slots[].content → leaf
- [x] Apollo codegen regenerated against current `apps/cms/schema.graphql`
- [x] `GraphQLContentClient` mappers handle all 12 types with recursive mapping
- [x] `firstSectionTitle()` checks all section types
- [x] Existing tests updated/passing

## Source links

- Issue: [#286](https://github.com/JesusFilm/forge/issues/286)
- PRs:
- None
