# Design QA: Watch full-height autocomplete

## Source

- Reference: `/var/folders/6p/w9935mls6tscffgs265g7fr40000gn/T/codex-clipboard-54c4d75f-0515-4bcf-8f25-4c73f859c5b0.png`
- Desktop implementation: `.tmp/design-qa/watch-search-panel-desktop-full-height.png`
- Mobile implementation: `.tmp/design-qa/watch-search-panel-mobile-full-height.png`
- Side-by-side comparison: `.tmp/design-qa/watch-search-panel-reference-comparison.png`

## Comparison evidence

- The comparison was normalized to 844 pixels high because the supplied source
  is a cropped reference with a different aspect ratio from the live viewport.
- The white search input remains the visual primary. The dark panel is attached
  beneath it with an 8-pixel gap and exact matching horizontal bounds.
- At 1280 by 720, both field and panel run from x=255 to x=1025. The panel runs
  from y=108 to y=704, using all remaining height with a 16-pixel safe area.
- At 390 by 844, both field and panel run from x=20 to x=314. The panel runs
  from y=128 to y=828, leaving the same 16-pixel bottom safe area.
- “Searching in” and the compact language selector form a subdued context row
  inside the panel, followed by Search Suggestions, Video, Collection, and
  Segment groups. Scroll remains internal with no visible scrollbar.
- Typography, muted metadata, separators, icons, spacing, and rounded borders
  preserve the established Watch search visual language.
- Blur hides the panel without clearing results. Refocusing restores the same
  rows immediately, while changing the query or language starts a fresh request.
- Pointer and keyboard checks cover focus restoration, language selection,
  phrase selection without submit, content navigation, Escape, and touch scroll.

## Iteration history

- The first pass expanded the panel before a suggestion-eligible query and
  obscured the empty-state category cards. The final build keeps only a compact
  language context row visible before typing and expands the panel once results
  are loading or available.
- The first test pass also exposed that hiding on blur could make the language
  control unreachable and that Escape needed a two-stage behavior. Both were
  corrected before the final screenshots and verification.

## Result

final result: passed
