---
title: "fix: Keep Watch collection overview within its scroll group"
type: "fix"
status: "completed"
date: "2026-07-14"
---

# fix: Keep Watch collection overview within its scroll group

## Summary

Keep each desktop collection overview visible while its grouped video list scrolls, then release it at the collection group's boundary. Preserve the current stacked mobile layout and inventory content.

## Problem Frame

The `/watch/videos` inventory renders collection artwork, metadata, CTA, and description beside a much taller list of videos. The overview currently stretches with the grid row and scrolls away, leaving the list without collection context. The requested behavior is a bounded sticky overview that follows the viewport only while its own collection block remains active.

## Requirements

- R1. At desktop grid widths, the full collection overview remains visible as the adjacent video rows scroll.
- R2. The sticky overview stops at the top and bottom boundaries of its own collection group and never follows into the next group.
- R3. At widths below the two-column breakpoint, collection content retains the existing normal-flow stacked layout.
- R4. Existing artwork, labels, title, CTA, description truncation, borders, rounding, routes, and video ordering remain unchanged.
- R5. The fix adds no client-side runtime work and does not degrade inventory page loading behavior.
- R6. Focused automated coverage and desktop/mobile browser proof demonstrate the responsive scroll contract.

## Key Technical Decisions

- **Keep the overview cohesive:** Apply sticky behavior to the complete overview content rather than detaching only the description from its artwork, title, and CTA.
- **Use CSS-only responsive stickiness:** Make the overview self-sized and sticky only at the existing desktop grid breakpoint, avoiding JavaScript scroll listeners or observers.
- **Separate paint from sticky positioning:** Keep the background and divider on the stretched sidebar grid cell, then position a nested overview so the color spans the full list while only the content follows scroll.
- **Keep the collection section as the containing boundary:** Ensure the rounded group wrapper does not become the sticky element's scroll container while retaining visual clipping, so normal sticky containment ends at the parent block.
- **Assert the layout contract near the route fixture:** Extend the existing language inventory page test data with a grouped collection and verify the responsive sticky and containment classes in rendered markup.

## Assumptions

- The sticky offset should clear the fixed desktop Watch header without pinning the overview unusually low in the viewport.
- Mobile and tablet single-column layouts should not become sticky because doing so would hold a tall overview above its own video rows.
- “Collection description” refers to keeping the complete overview card in context rather than moving the description independently.

## Implementation Units

### U1. Track the inventory scroll fix

- **Goal:** Create the required roadmap ticket for this bounded Watch inventory UX change and mark it in progress before code changes begin.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** None
- **Files:** `docs/roadmap/content-discovery/feat-253-watch-collection-overview-sticky-scroll.md`
- **Approach:** Record the exact component, expected desktop boundary behavior, mobile non-goal, focused test, browser proof, and loading-performance constraint in the content-discovery lane.
- **Patterns to follow:** `docs/roadmap/content-discovery/feat-192-watch-language-inventory-page.md` and `docs/roadmap/content-discovery/feat-250-watch-language-inventory-query-performance.md`.
- **Test scenarios:** Test expectation: none -- this unit is roadmap bookkeeping only.
- **Verification:** The ticket uses the next repository feature ID and has `status: "in-progress"` before U2 starts.

### U2. Add bounded responsive sticky behavior

- **Goal:** Keep the collection overview beside its video rows while scrolling without escaping the current group.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** U1
- **Files:** `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`, `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx`
- **Approach:** Adjust the group wrapper's clipping semantics so it remains a visual boundary without capturing sticky positioning. Keep the sidebar grid cell stretched to paint its background and divider for the full group height, then make a nested overview sticky at the desktop breakpoint with a header-safe top offset; leave base styles in normal document flow.
- **Patterns to follow:** The existing `lg:grid` breakpoint in `GroupedVideoListSection`, sticky Watch layout conventions in `apps/web/src/components/watch/SeriesHero.tsx`, and server-rendered inventory assertions in the localized videos route test.
- **Test scenarios:**
  - Render a collection plus multiple child videos and confirm the group retains a bounded parent wrapper, the sidebar owns the full-height background and divider, and the nested overview has desktop sticky and top-offset classes.
  - Confirm sticky classes are breakpoint-prefixed and the base overview remains normal-flow for mobile widths.
  - Confirm the rendered collection still contains its image, label, title, CTA, description, and child rows.
- **Verification:** The focused localized inventory route test passes, web type checking succeeds, and the change introduces no client component or scroll handler.

### U3. Prove the scroll boundary and close the ticket

- **Goal:** Validate the visual behavior on the real inventory surface and complete roadmap bookkeeping.
- **Requirements:** R1, R2, R3, R4, R5, R6
- **Dependencies:** U2
- **Files:** `docs/roadmap/content-discovery/feat-253-watch-collection-overview-sticky-scroll.md`
- **Approach:** Browser-smoke a populated collection at desktop and mobile widths. At desktop, capture the overview near the start, middle, and end of its parent group to show that it follows and then releases; at mobile, confirm the overview scrolls normally above the rows. Check page timing and console output for regression signals, then mark the ticket complete.
- **Test scenarios:** Test expectation: none -- browser acceptance is covered by the explicit verification outcomes.
- **Verification:** Screenshots show the overview tracking only inside its group, the next group starts cleanly, mobile content remains usable, no console errors appear, and the roadmap ticket is `status: "complete"`.

## Scope Boundaries

- Do not change inventory data queries, grouping, sorting, routes, translations, or content truncation.
- Do not make the overview sticky in single-column layouts.
- Do not alter the global Watch header, section navigation, other collection cards, or unrelated sticky hero behavior.
- Do not add a reusable sticky abstraction for this localized layout change.
