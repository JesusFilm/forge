---
id: "feat-766"
title: "Fit the Watch search overlay's input and language row at 320 px and with the keyboard open"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-21"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "search"
  - "ui"
---

## Problem

Round-04 audit, production, 2026-10-20, headless Chromium. Captures are in
`round-04/dialogs/` in the audit user-data.

- **320x640.** The search input is 180 px wide beside the overlay's language
  control. Its placeholder "Search or browse topics…" is hard-cut to
  "Search or browse topi" (an input cannot show an ellipsis). The
  language-scope row reads "Search in …", and the browse link reads
  "All videos on single pa…".
- **320x360** (a stand-in for an open on-screen keyboard). The scope row's
  "English" pill runs into the ↵ submit glyph. The suggestion list
  scroller is 157 px tall.

Open PR #2663 (search focus containment) edits the same `SearchOverlay.tsx`
and is conflicting with main. Land or rebase it first, or coordinate.

## Entry Points — Read These First

1. `apps/web/src/components/SearchOverlay.tsx` — scope row (`searchInLanguage`),
   `allVideosOnSinglePage` link.
2. `apps/web/src/components/FloatingSearchField.tsx` — `FloatingSearchFieldInput`.
3. `apps/web/src/components/FloatingSearchProvider.tsx` — overlay header grid.
4. `apps/web/src/components/watch/LanguageCombobox.tsx`.

## Grep These

- `searchInLanguage`
- `allVideosOnSinglePage`
- `placeholder`

## What To Build

- On phones, use a placeholder that fits the input. The existing
  `FloatingSearch.openSearch` ("Search videos") or `submitSearch` both
  already have translations; do not add English-only copy.
- Let the scope row wrap, or give the pill its own line below about 360 px,
  so the label and pill never overlap the submit glyph.
- Keep the results scroller usable on short viewports. Check
  `visualViewport` behaviour on a real iOS/Android keyboard.

## Constraints

- Do not change search ranking or requests.
- Keep the focus containment from #2663.

## Verification

- At 320x640 and 320x360 no overlay text is clipped mid-word and no control
  overlaps another (measure with `getBoundingClientRect`).
- Real-device check with the on-screen keyboard open.
