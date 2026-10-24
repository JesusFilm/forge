---
title: "fix: Compact Watch body title on small mobile screens"
type: fix
status: completed
date: 2026-07-16
---

# fix: Compact Watch body title on small mobile screens

## Summary and Problem Frame

Long Watch video titles occupy too much space beside the Download action on
small mobile screens. Reduce only the smallest viewport tier while preserving
the current title typography at `sm`, `md`, and larger breakpoints.

## Requirements

- R1. The Watch body title uses a more compact font size below the `sm` breakpoint.
- R2. The existing 27px title size remains active from `sm` until `md`.
- R3. The existing `md:text-4xl` and `xl:text-5xl` sizes remain unchanged.
- R4. The title and Download action retain their current single-row layout and wrapping behavior.

## Key Technical Decisions

- **Use the existing responsive utility chain:** Add a smaller base utility and move the current 27px value behind `sm` so the change is isolated to narrow phones.
- **Keep the component contract unchanged:** This is a presentational correction in `WatchBody`; no data, routing, download, or semantic heading behavior should change.
- **Pin the breakpoint contract in the focused unit test:** Assert the base, `sm`, `md`, and `xl` typography classes together so later styling changes cannot accidentally widen the compact tier.

## Implementation Units

### U1. Add the small-mobile title tier

- **Goal:** Make long Watch body titles more compact on small phones without changing larger viewport typography or title-row behavior.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** None.
- **Files:**
  - `docs/roadmap/platform/feat-184-watch-body-small-mobile-title.md`
  - `apps/web/src/components/watch/WatchBody.tsx`
  - `apps/web/src/components/watch/__tests__/WatchBody.test.tsx`
- **Approach:** Create the required in-progress roadmap ticket, replace the title's base 27px class with the established compact heading size, restore 27px at `sm`, and leave the existing medium and desktop breakpoint classes intact. Complete the ticket after verification.
- **Patterns to follow:** The current breakpoint progression in `apps/web/src/components/watch/WatchBody.tsx`; the class-contract assertions in `apps/web/src/components/watch/__tests__/WatchBody.test.tsx`; adjacent Watch responsive typography in `apps/web/src/components/watch/SeriesHero.tsx`.
- **Test scenarios:**
  - Given a Watch body with a long title and downloads, rendering the component exposes the compact base title class below `sm`.
  - The rendered title includes the current 27px class at `sm`, `text-4xl` at `md`, and `text-5xl` at `xl`.
  - The title row retains `flex-nowrap`, title flex growth, and the Download action's shrink protection.
- **Verification:** Run the focused `WatchBody` test, the web typecheck, and a narrow mobile browser smoke that visually confirms a long title is more compact while a medium viewport retains the existing scale.

## Scope Boundaries

- Do not change title copy, semantic heading level, line height, font weight, Download button styling, or title-row layout.
- Do not alter `SeriesHero`, `HeroPlayer`, or other Watch headings.
- Do not change any medium or desktop font sizes.
