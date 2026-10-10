---
title: "Localized Watch topic cards must submit localized queries"
date: "2026-08-14"
category: "ui-bugs"
module: "Watch search"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "Browse-topic cards display localized labels but submit the English structural search term."
  - "A localized topic click changes the controlled input and outbound Watch search query to English text."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web"
tags:
  - "watch-search"
  - "localized-query"
  - "browse-topics"
  - "i18n"
  - "explicit-submit"
---

# Localized Watch topic cards must submit localized queries

## Problem

Watch browse-topic cards resolve their visible titles from the active UI
catalog, but the click path submitted the adjacent English `searchTerm`.
Viewers could therefore select a localized label such as `圣经故事` and search
for `bible stories` instead.

## Symptoms

- The card label and the search input changed to different languages after a
  click.
- Localized topic searches could return no results, while the UI obscured
  whether the submitted text matched the label the viewer selected.

## What Didn't Work

- Translating the card label alone did not fix search behavior because the
  click handler still received `cat.searchTerm`.
- Testing only the card's accessible label did not detect the defect because it
  did not inspect the controlled input or outbound request.
- Adding a per-locale query map in TypeScript would duplicate translation
  catalogs and create another source of truth.

## Solution

Pass the already-resolved localized title into the existing category search
handler:

```tsx
const title = t(CATEGORY_TITLE_KEYS[cat.searchTerm])

<button
  key={cat.searchTerm}
  onClick={() => handleCategoryClick(title)}
  aria-label={title}
/>
```

`handleCategoryClick` delegates that value to the existing `search(query)`
path (`apps/web/src/components/SearchOverlay.tsx:852-855` and
`apps/web/src/components/SearchOverlay.tsx:1391-1400`). Keep `cat.searchTerm`
for stable structural identity: React keys, icon lookup, translation-key lookup,
and test IDs. The same boundary is documented next to the category type in
`apps/web/src/lib/search-categories.ts:49-50`.

The regression test should use production catalogs and assert all observable
boundaries. The current test covers Arabic, English, Russian, and Simplified
Chinese, then verifies the card label, controlled input, outbound query, and
one request per click
(`apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx:2544-2575`).

## Why This Works

A structural identifier needs stable spelling so code can use it as a key. A
user-facing query needs to preserve the language-specific meaning the viewer
selected. These are separate responsibilities even when they originate from
the same card.

Reusing `search()` also preserves the existing submission contract. That path
updates the controlled query, normalizes the submitted value, maintains request
freshness, and calls `searchWatchDirect`
(`apps/web/src/components/FloatingSearchController.tsx:346-390` and
`apps/web/src/components/FloatingSearchController.tsx:449-455`). A separate
topic-card request path would duplicate those behaviors.

## Prevention

- Treat internal category terms as structural identity, not user-facing query
  text.
- Send deliberate UI selections through the same explicit-search boundary as
  other submitted queries.
- Test both displayed text and the outbound request. A localized-label-only
  assertion can pass while the application still sends English.
- Include representative Latin, Cyrillic, Arabic, and Han-script locales so the
  test proves the behavior is locale-general rather than Chinese-specific.
- Assert one request per activation when preserving request count is part of the
  change contract.

## Related Issues

- [GitHub issue #1897](https://github.com/JesusFilm/forge/issues/1897)
- [Separate Watch search drafts, suggestions, and explicit submission](../design-patterns/watch-search-draft-suggestion-submit-separation.md)
- [Chinese lexical and playback language conflation](../logic-errors/watch-search-chinese-lexical-playback-language-conflation.md)
