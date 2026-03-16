---
artifactType: plan
sourceIssueNumber: 304
sourceIssueTitle: "feat(mobile-expo): expand data layer for all 10 CMS section types"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/304"
linkedPrs: []
---

# Plan Artifact: #304

## Objective

- Data layer maps all 10 active section types returned by the CMS to typed models consumable by section renderers.
- Nested content in `Section` (wrapper with backgroundColor, blurHash) and `Container` (grid with slots/gridSpan) is recursively resolved.
- PromoBanner and InfoBlocks mappings removed or stubbed as no-ops.
- GraphQL query/fragments updated to fetch all fields for each section type (reference: iOS query).

## Planned approach

1. Update the GraphQL query and fragments to match the pattern in `mobile/ios/GraphQL/Operations/GetWatchExperience.graphql` — separate fragment per section type, nested fragments for Section/Container content.
2. Add typed models/interfaces for each section type; extend the existing section mapper to switch on `__typename`.
3. For recursive nesting (Section → content, Container → slots → content), use a shared mapping function that can resolve nested dynamic zones.

## Validation

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

## Source links

- Issue: [#304](https://github.com/JesusFilm/forge/issues/304)
- PRs:
- None
