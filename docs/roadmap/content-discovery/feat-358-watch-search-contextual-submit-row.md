---
id: "feat-358"
title: "Move Watch search submission into the suggestion context row"
owner: "urim"
priority: "P1"
status: "complete"
completed_date: "2026-08-12"
start_date: "2026-08-12"
duration: 1
depends_on:
  - "feat-357"
blocks: []
tags:
  - "watch"
  - "search"
  - "autocomplete"
  - "web"
---

## Problem

The outlined Search button inside the primary field competes with the query, while the secondary language row does not explain how the current query and language will be submitted.

## What To Build

1. Remove the visible submit button from the modal search field while preserving native Enter and mobile Search-key submission.
2. Render a contextual row in the suggestion panel: `Search in [language] for "query" ↩`, with only the query emphasized.
3. Keep the language name as a distinct outlined button that opens the existing full-panel language picker.
4. Let the entire context row submit the current query for pointer users, except when the language control is activated.

## Verification

- The primary field has no visible submit button.
- Enter and the mobile Search keyboard action still submit.
- The language chip opens the full-panel language picker.
- Clicking anywhere else in the contextual row submits the current query.
- The row remains legible at narrow mobile widths.

## Completion Evidence

- The 109-test Watch search interaction suite passed with the field submit button absent, native form submission intact, and the contextual query action covered.
- Web TypeScript and targeted ESLint checks passed.
- Browser verification at 390 x 844 confirmed the full `Search in [English] for "Footbal" ↩` row, no standalone Search button, live suggestions, and the full-panel language picker.
- The refined language control computes to a fully transparent background with a 10 px corner radius and a 20% white outline.
- Mobile browser verification confirmed a full-width row hover state, an independent language-picker click, and row-click suggestion dismissal without changing the `/watch` URL.
- The final mobile copy reads `Search in English for "Paul"`; browser inspection confirmed the query alone renders at font weight 600.
- The outlined language button includes a leading language glyph and trailing chevron; the chevron rotates with the picker, and tightened mobile spacing preserves the complete `Paul` query and return-key cue.
- A first-click regression test now keeps the original language trigger mounted while its full-panel picker opens; live mobile verification confirmed one click focuses language search.
- Mobile spacing now leaves a measured 6 px gap after `Search in` while the full `for "Paul"` copy remains untruncated.
- The context row uses a roomier 16 px horizontal inset from 480 px upward while retaining the compact 6 px inset on narrow phones.
- Completed results now collapse the helper to its compact language-only state; editing the query or changing the language restores the contextual submit action.
- Completed results use the stateful copy `Searching in [language]`; initial and edited drafts retain the actionable `Search in` wording.
- Final review removed duplicate touch activation, localized the complete contextual sentence instead of hard-coding English connective copy, and preserved all six phrase suggestions plus six direct matches in the Web client.
- Final verification passed 120 focused Web tests, 79 focused Admin tests, Web/Admin typechecks, Admin lint, and desktop plus 390 x 844 mobile browser smoke with no console errors.
