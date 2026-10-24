# Design QA: Watch search-language takeover

## Source and implementation

- Source visual truth: `/var/folders/6p/w9935mls6tscffgs265g7fr40000gn/T/codex-clipboard-5070f2d6-681c-4307-9585-f536d1669111.png`
- Quiet text implementation: `.tmp/design-qa/watch-search-language-text-mobile-final.png`
- Full-panel language search: `.tmp/design-qa/watch-search-language-takeover-mobile-final.png`
- Focused comparison: `.tmp/design-qa/watch-search-language-text-reference-comparison.png`
- Browser CSS viewport: 390 by 844 at device pixel ratio 1.
- Browser visual viewport and saved screenshots: 375 by 812 pixels.
- State: Watch search modal, query `jes`, English search language; then language
  search open with its input focused.

## Full-view comparison evidence

- The supplied source shows the previous two-part language row: muted
  “Searching in” text plus a large bordered English selector with code badge and
  chevron. The implementation intentionally replaces that chrome with the
  requested single text action, “Searching in English.”
- The text action keeps the same muted secondary hierarchy and 56-pixel context
  row, but removes the nested field border, badge, background, and chevron.
- Activating the text action replaces the visible suggestions with a language
  search surface that has the exact panel bounds, radius, background, and
  available viewport height. Suggestions are also removed from the accessibility
  tree while language search is open.
- The takeover contains one focused search field, a visible 44-pixel close
  action, and the language results. Its internal scrollbar is visually hidden
  while touch, wheel, and keyboard scrolling remain available.

## Required fidelity surfaces

- Fonts and typography: existing Watch font, weight, line height, and muted
  stone hierarchy are preserved; English receives only a small contrast lift.
- Spacing and layout rhythm: the text action aligns to suggestion content with
  compact horizontal padding; takeover boundaries exactly match the panel.
- Colors and tokens: existing stone and white opacity tokens are reused without
  introducing a new surface or accent.
- Image quality and assets: no image assets are present in this control. Existing
  Lucide close icon use follows the product's established icon system.
- Copy and content: visible copy is exactly “Searching in English” for the
  current language; the takeover uses the existing localized language-search
  placeholder and real language names.

## Focused comparison evidence

- The focused side-by-side crop makes the deliberate simplification readable at
  equal 110-pixel height. No additional focused crop is needed because the only
  source element is the language context row.

## Interaction verification

- Clicking the text action opens the full-panel language search and focuses its
  input.
- Escape, the visible close button, or clicking outside dismisses the takeover.
- Dismissal restores the existing suggestion state without a backend request.
- Selecting a language closes the takeover, keeps the draft unsubmitted, and
  requests fresh suggestions for that language.
- The visible `N` control in local captures is Next.js development tooling and
  is not part of the shipped interface.

## Comparison history

- First pass: the language takeover inherited the component's thin visible
  scrollbar, a P2 noise regression against the requested focused state.
- Fix: takeover mode now hides the scrollbar while retaining scrolling.
- Post-fix evidence: `watch-search-language-takeover-mobile-final.png` shows a
  clean single-purpose panel with no suggestion content or scrollbar chrome.

## Findings

- No remaining P0, P1, or P2 findings.

## Follow-up polish

- None required for this scope.

## Result

final result: passed
