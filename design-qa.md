# Design QA: Watch grouped autocomplete

## Source

- Reference: `/var/folders/6p/w9935mls6tscffgs265g7fr40000gn/T/codex-clipboard-3359b99b-c4a0-4ea7-a120-87e08d029dd1.png`
- Desktop implementation: `.tmp/design-qa/watch-search-autocomplete-1440.png`
- Mobile implementation: `.tmp/design-qa/watch-search-autocomplete-mobile.png`
- Side-by-side comparison: `.tmp/design-qa/watch-search-reference-comparison.png`

## Comparison evidence

- Preserves the reference's dark translucent panel, small uppercase section
  labels, restrained separators, left-aligned content icons, and compact rows.
- Applies the requested hierarchy change: Search Suggestions are first, then
  direct Video, Collection, and Segment groups.
- Omits People, popularity counts, top-match promotion, and recent searches as
  requested or intentionally out of scope.
- Keeps the white search input dominant. The language control and autocomplete
  panel use lower-contrast dark surfaces so they read as secondary helpers.
- At 1440 by 900, the panel aligns below the search controls, caps at 640 pixels
  wide and 440 pixels high, and scrolls internally without a visible scrollbar.
- At 390 by 844, the panel remains inside the visual viewport. Query rows are
  44 pixels high and metadata rows are 75 pixels high, meeting the minimum
  touch-target requirement.
- Keyboard and pointer tests cover phrase selection without search submission,
  direct-content navigation, grouped ordering, IME composition, cancellation,
  and touch scrolling.

## Result

final result: passed
