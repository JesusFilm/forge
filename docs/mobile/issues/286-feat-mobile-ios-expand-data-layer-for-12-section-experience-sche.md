---
artifactType: issue
issueNumber: 286
issueTitle: "feat(mobile-ios): expand data layer for 12-section Experience schema"
issueUrl: "https://github.com/JesusFilm/forge/issues/286"
state: "CLOSED"
closedAt: "2026-03-10T04:15:40Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #286

## Background

Epic #100's data layer (completed in #103) supports only 4 section types: MediaCollection, PromoBanner, InfoBlocks, CTA. The CMS Experience schema now includes **12 section types** in `ExperienceBlocksDynamicZone` (renamed from `ExperienceSectionsDynamicZone` in #301). This foundational issue expands the data layer so all 10 parallel renderer issues can proceed without merge conflicts on shared files.

**New types to add:** VideoHero, Text, Container (structural/nesting), Section wrapper (structural/nesting), RelatedQuestions, BibleQuotesCarousel, Card, Video.

## Expected outcome

The iOS data layer (models, GraphQL query, mapping) supports all 12 Experience section types including full 3-level nesting for Container and Section wrapper components, aligned with the current CMS schema (`ExperienceBlocksDynamicZone`).

## Acceptance criteria

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

## Possible solution(s)

Not provided in source issue.

## References

- Parent: #100
- Depends on: #103 (closed)
- CMS schema: `apps/cms/schema.graphql` (`ExperienceBlocksDynamicZone`, `ContainerSlotContentDynamicZone`, `SectionContentDynamicZone`)
- Related schema PRs: #301 (blocks rename + streamingUrl), #224 (Video component)
- PR: #298

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
