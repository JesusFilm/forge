---
artifactType: plan
sourceIssueNumber: 433
sourceIssueTitle: "feat(mobile-ios): add EasterDates leaf renderer"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/433"
linkedPrs: []
---

# Plan Artifact: #433

## Objective

- A new `EasterDatesView` renders a collapsible card with a warm gradient background.
- Collapsed state shows the title (e.g., "When is Easter celebrated in 2026?") with a chevron.
- Expanded state shows three rows: Western Easter, Orthodox Easter, and Jewish Passover — each with the CMS-provided label and the computed/formatted date.
- The component works at all nesting levels: top-level blocks, container slots, and nested container slots inside section wrappers.
- Dates are locale-aware via `DateFormatter`.

## Planned approach

1. **Full leaf renderer pipeline** following the established pattern (CTAView, RelatedQuestionsView, etc.):
   - GraphQL fragment → inline spreads → codegen → data model → enum case → mapper → view → dispatch.

2. **Date computation**: Create `EasterDateCalculator.swift` utility with:
   - `westernEaster(year:)` — Anonymous Gregorian computus algorithm.
   - `orthodoxEaster(year:)` — Julian calendar algorithm + 13-day Gregorian offset.
   - `passover(year:)` — Foundation `Calendar(identifier: .hebrew)` for 15 Nisan conversion.
   - `formattedDate(_:locale:)` — `DateFormatter` with `.full` date style.

3. **Expand/collapse UI**: Use `@State private var isExpanded` with `withAnimation` and a chevron rotation, similar to the pattern in `RelatedQuestionsView`.

## Validation

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

## Source links

- Issue: [#433](https://github.com/JesusFilm/forge/issues/433)
- PRs:
- None
