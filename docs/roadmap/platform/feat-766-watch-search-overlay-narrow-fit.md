---
id: "feat-766"
title: "Fit the Watch search overlay's input and language row at 320 px and with the keyboard open"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
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

## Resolution

Done in PR #2663 (2026-10-20), on top of its focus containment. The
header language control is hidden while search is open, so on phones the
search field (and the instant shell's field) now spans that empty column.
The language row wraps to at most two lines below 480 px.

Measured on a local fixture of the real overlay (headless Chromium,
replayed production search responses):

| Check                                              | Before              | After         |
| -------------------------------------------------- | ------------------- | ------------- |
| 320x640 input width / placeholder width            | 180 / 206 px (cut)  | 260 / 206 px  |
| 320x640 language pill right edge vs row right edge | 300 vs 220 px       | 220 vs 300 px |
| 320 pill overlaps the submit glyph                 | yes                 | no            |
| Language row bottom vs results top (320)           | 172 / 224 px        | 200 / 224 px  |
| "All videos on single page" link                   | cut ("…single pa…") | two lines     |

Not done: the results scroller is still 136 px tall at 320x360. A real
on-screen keyboard does not shrink the layout viewport on iOS Safari or
Android Chrome, so 320x360 overstates the loss; the suggestion panel
already follows `visualViewport`. No real-device keyboard check was run.
