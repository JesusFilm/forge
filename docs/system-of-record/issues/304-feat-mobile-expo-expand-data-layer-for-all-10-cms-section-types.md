---
artifactType: issue
issueNumber: 304
issueTitle: "feat(mobile-expo): expand data layer for all 10 CMS section types"
issueUrl: "https://github.com/JesusFilm/forge/issues/304"
state: "CLOSED"
closedAt: "2026-03-09T21:30:27Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #304

## Background

The initial data layer (#92) was built when the epic assumed only 4 section types (MediaCollection, PromoBanner, InfoBlocks, CTA). The CMS schema has since been updated with a richer set of 10 active section types in the `ExperienceSectionsDynamicZone` union. The iOS native app's GraphQL query (`mobile/ios/GraphQL/Operations/GetWatchExperience.graphql`) already handles all 10 types and can serve as a reference.

This issue extends the Expo data layer to map all 10 section types and handle nested content in Section and Container wrappers. PromoBanner and InfoBlocks are deprecated and should be dropped.

## Expected outcome

- Data layer maps all 10 active section types returned by the CMS to typed models consumable by section renderers.
- Nested content in `Section` (wrapper with backgroundColor, blurHash) and `Container` (grid with slots/gridSpan) is recursively resolved.
- PromoBanner and InfoBlocks mappings removed or stubbed as no-ops.
- GraphQL query/fragments updated to fetch all fields for each section type (reference: iOS query).

## Acceptance criteria

- [x] `VideoHero` mapped: heading, subheading, video (linked Video entity), ctaLabel, ctaLink, sectionKey.
- [x] `MediaCollection` mapped: all variants (carousel, collection, grid, hero, player), items with video/imageOverride/titleOverride/subtitleOverride/linkToSectionKey/collectionSize, showItemNumbers, categoryLabel, ctaLink, footerText, description, subtitle, title, sectionKey.
- [x] `CTA` mapped: heading, body, buttonLabel, buttonLink, variant (primary/secondary), sectionKey.
- [x] `Text` mapped: heading, headingLevel (h1–h6), subtitle, content, variant (default/lead/small), sectionKey.
- [x] `Video` mapped: title, subtitle, streamingUrl, media (UploadFile), video (linked Video entity), sectionKey.
- [x] `BibleQuotesCarousel` mapped: heading, quotes array (text, reference, attribution, backgroundImage, ctaLabel, ctaLink), sectionKey.
- [x] `RelatedQuestions` mapped: heading, questions array (question, answer), sectionKey.
- [x] `Card` mapped: title, description, media, link, variant (default/featured), sectionKey.
- [x] `Section` mapped: backgroundColor (dark/default/light/primary), blurHash, sectionKey, nested content dynamic zone (recursive).
- [x] `Container` mapped: sectionKey, slots array with gridSpan and nested content dynamic zone (recursive).
- [x] PromoBanner and InfoBlocks dropped or stubbed (id-only, no rendering data).
- [x] Data layer remains testable (mockable client, clear separation).

## Possible solution(s)

1. Update the GraphQL query and fragments to match the pattern in `mobile/ios/GraphQL/Operations/GetWatchExperience.graphql` — separate fragment per section type, nested fragments for Section/Container content.
2. Add typed models/interfaces for each section type; extend the existing section mapper to switch on `__typename`.
3. For recursive nesting (Section → content, Container → slots → content), use a shared mapping function that can resolve nested dynamic zones.

## References

- Parent: #89
- Depends on: #92
- [apps/cms/schema.graphql](apps/cms/schema.graphql) — `ExperienceSectionsDynamicZone` union (line 693), `SectionContentDynamicZone` (line 1131), `ContainerSlotContentDynamicZone` (line 511)
- [mobile/ios/GraphQL/Operations/GetWatchExperience.graphql](mobile/ios/GraphQL/Operations/GetWatchExperience.graphql) — reference query handling all 10 types
- Sample Experience: documentId `lr6luew6oh4hurag4n8s0ddz` (slug: `easter`) for validation

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
