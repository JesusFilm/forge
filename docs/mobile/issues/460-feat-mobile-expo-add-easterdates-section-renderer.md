---
artifactType: issue
issueNumber: 460
issueTitle: "feat(mobile-expo): add EasterDates section renderer"
issueUrl: "https://github.com/JesusFilm/forge/issues/460"
state: "CLOSED"
closedAt: "2026-03-13T06:10:12Z"
labels: []
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #460

## Background

The Easter page on jesusfilm.org (https://www.jesusfilm.org/watch/easter.html/english.html) includes an "Easter Dates" section that shows:

- Dynamic title: "When is Easter celebrated in {year}?"
- Western Easter (Catholic/Protestant) date — computed via Gregorian computus algorithm
- Orthodox Easter date — computed via Julian calendar conversion
- Jewish Passover date — computed via Hebrew calendar

Both the web app and iOS app already implement this section. The mobile Expo app is missing it entirely — no renderer, no type model, no mapper case. The CMS schema already defines all required fields on `ComponentSectionsEasterDates`; no schema changes needed.

The shared GraphQL query in `packages/graphql/src/watchExperience.ts` currently only fetches `id` for EasterDates. Expanding it to include all fields is a justified side effect of this mobile-expo work (per bounded context rules).

## Expected outcome

A new `EasterDatesRenderer` component in mobile Expo that:

1. Receives the EasterDates section data from Strapi via the expanded GraphQL query
2. Computes Western Easter, Orthodox Easter, and Passover dates for the current year
3. Renders a collapsible card with warm gradient background matching the web/iOS design
4. Replaces `{year}` placeholder in the title with the current year
5. Formats dates using locale-aware formatting

## Acceptance criteria

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

## Possible solution(s)

Reference the existing implementations:

- **iOS**: `EasterDateCalculator.swift` + `EasterDatesView.swift` (closest to RN implementation)
- **Web**: `EasterDates.tsx` (inline computus, responsive collapsible)

Port the date calculation algorithms and create a React Native component with `LayoutAnimation` for expand/collapse and `LinearGradient` for the background.

## References

- Web reference: https://www.jesusfilm.org/watch/easter.html/english.html
- `apps/web/src/components/sections/EasterDates.tsx` — web implementation
- `mobile/ios/Sources/ForgeMobile/Views/Sections/EasterDatesView.swift` — iOS implementation
- `mobile/ios/Sources/ForgeMobile/Utilities/EasterDateCalculator.swift` — date algorithms
- `apps/cms/schema.graphql` — `ComponentSectionsEasterDates` type (already has all fields)
- Epic #89 — parent Expo epic

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
