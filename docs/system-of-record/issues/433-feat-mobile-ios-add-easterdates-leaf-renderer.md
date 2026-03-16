---
artifactType: issue
issueNumber: 433
issueTitle: "feat(mobile-ios): add EasterDates leaf renderer"
issueUrl: "https://github.com/JesusFilm/forge/issues/433"
state: "CLOSED"
closedAt: "2026-03-12T21:27:48Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #433

## Background

The CMS now includes a new `sections.easter-dates` component — a collapsible card that displays Western Easter (Catholic/Protestant), Orthodox Easter, and Jewish Passover dates for the current year. The GraphQL schema types have been generated (`ComponentSectionsEasterDates` appears in `ExperienceBlocksDynamicZone` and `ContainerSlotContentDynamicZone`), but the iOS app has no implementation: no GraphQL fragment, no data model, no mapper, and no SwiftUI view.

The component is server-driven: labels (title template, tradition labels) come from Strapi; actual dates are computed at runtime using well-known algorithms (Gregorian computus, Julian computus + offset, and Foundation's Hebrew calendar for Passover).

Reference: [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html)

## Expected outcome

- A new `EasterDatesView` renders a collapsible card with a warm gradient background.
- Collapsed state shows the title (e.g., "When is Easter celebrated in 2026?") with a chevron.
- Expanded state shows three rows: Western Easter, Orthodox Easter, and Jewish Passover — each with the CMS-provided label and the computed/formatted date.
- The component works at all nesting levels: top-level blocks, container slots, and nested container slots inside section wrappers.
- Dates are locale-aware via `DateFormatter`.

## Acceptance criteria

- [x] `EasterDatesFields` GraphQL fragment added to `SectionFragments.graphql`.
- [x] Inline fragment spreads added to `GetWatchExperience.graphql` in 3 locations (top-level blocks, container slots, nested container slots).
- [x] Apollo codegen runs successfully with the new fragment.
- [x] `EasterDatesSection` data model added to `SectionLeafModels.swift` (Sendable, Codable).
- [x] `.easterDates(EasterDatesSection)` case added to `SectionContent` enum with `id` accessor.
- [x] `mapEasterDates` mapper function added to `SectionMappers.swift`.
- [x] Mapping calls wired into `GraphQLContentClient.swift` (`mapTopLevelSection`, `mapSlotContent`, `mapNestedSlotContent`).
- [x] `EasterDateCalculator` utility computes correct dates for Western Easter, Orthodox Easter, and Passover.
- [x] `EasterDatesView` renders collapsible card with expand/collapse animation and gradient background.
- [x] `SectionContentView` dispatches `.easterDates` case to `EasterDatesView`.
- [x] SwiftUI previews provided for collapsed and expanded states.
- [x] Project builds without errors.

## Possible solution(s)

1. **Full leaf renderer pipeline** following the established pattern (CTAView, RelatedQuestionsView, etc.):
   - GraphQL fragment → inline spreads → codegen → data model → enum case → mapper → view → dispatch.

2. **Date computation**: Create `EasterDateCalculator.swift` utility with:
   - `westernEaster(year:)` — Anonymous Gregorian computus algorithm.
   - `orthodoxEaster(year:)` — Julian calendar algorithm + 13-day Gregorian offset.
   - `passover(year:)` — Foundation `Calendar(identifier: .hebrew)` for 15 Nisan conversion.
   - `formattedDate(_:locale:)` — `DateFormatter` with `.full` date style.

3. **Expand/collapse UI**: Use `@State private var isExpanded` with `withAnimation` and a chevron rotation, similar to the pattern in `RelatedQuestionsView`.

## References

- Parent: #100
- Union types: `ExperienceBlocksDynamicZone`, `ContainerSlotContentDynamicZone` (NOT `SectionContentDynamicZone`)
- CMS schema: `apps/cms/src/components/sections/easter-dates.json`
- Pattern files: `CTAView.swift`, `RelatedQuestionsView.swift`, `SectionMappers.swift`, `GraphQLContentClient.swift`
- Reference website: https://www.jesusfilm.org/watch/easter.html/english.html

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
