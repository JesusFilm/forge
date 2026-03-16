---
artifactType: plan
sourceIssueNumber: 370
sourceIssueTitle: "feat(mobile-expo): tappable carousel thumbnails with scroll-to-section navigation"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/370"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #370

## Objective

Not provided in source issue.

## Planned approach

Not provided in source issue.

## Validation

- [ ] `MediaItemCard` wrapped in `Pressable` with visual feedback
- [ ] When `linkToSectionKey` is set, tapping scrolls to the section with that `sectionKey`
- [ ] Parent `ScrollView`/`FlatList` ref exposed for programmatic `scrollTo`
- [ ] Each section registers its layout position (via `onLayout` or `ref`) keyed by `sectionKey`
- [ ] Play icon overlay on video thumbnails
- [ ] Smooth animated scroll to target section
- [ ] Unit tests for navigation logic

## Source links

- Issue: [#370](https://github.com/JesusFilm/forge/issues/370)
- PRs:
- None
