---
artifactType: plan
sourceIssueNumber: 460
sourceIssueTitle: "feat(mobile-expo): add EasterDates section renderer"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/460"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #460

## Objective

A new `EasterDatesRenderer` component in mobile Expo that:

1. Receives the EasterDates section data from Strapi via the expanded GraphQL query
2. Computes Western Easter, Orthodox Easter, and Passover dates for the current year
3. Renders a collapsible card with warm gradient background matching the web/iOS design
4. Replaces `{year}` placeholder in the title with the current year
5. Formats dates using locale-aware formatting

## Planned approach

Reference the existing implementations:

- **iOS**: `EasterDateCalculator.swift` + `EasterDatesView.swift` (closest to RN implementation)
- **Web**: `EasterDates.tsx` (inline computus, responsive collapsible)

Port the date calculation algorithms and create a React Native component with `LayoutAnimation` for expand/collapse and `LinearGradient` for the background.

## Validation

- [ ] GraphQL query expanded: `watchExperience.ts` fragment for `ComponentSectionsEasterDates` includes all CMS fields (`sectionKey`, `easterDatesTitle`, `westernEasterLabel`, `orthodoxEasterLabel`, `passoverLabel`, `locale`)
- [ ] `graphql-env.d.ts` regenerated, `WatchExperienceBlock` type updated
- [ ] `EasterDatesSection` interface added to `sectionModels.ts`
- [ ] `mapEasterDates()` function added to `sectionMapper.ts`
- [ ] `case "easterDates"` added to `SectionDispatcher.tsx`
- [ ] `EasterDatesRenderer.tsx` created with:
  - Computus algorithm for Western Easter
  - Julian-to-Gregorian conversion for Orthodox Easter
  - Hebrew calendar computation for Passover
  - Collapsible accordion with animated chevron
  - Warm gradient background (amber/orange)
  - Locale-aware date formatting
- [ ] Component visually matches the web reference
- [ ] Renders on both iOS simulator and Android emulator
- [ ] No CMS schema changes

## Source links

- Issue: [#460](https://github.com/JesusFilm/forge/issues/460)
- PRs:
- None
