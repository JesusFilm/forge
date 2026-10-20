---
id: "feat-769"
title: "Split the Watch Montserrat font into unicode-range subsets"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "performance"
  - "i18n"
---

## Problem

Every Watch route preloaded one 205.7 KB Montserrat variable woff2 holding
Latin, Latin Extended, Vietnamese, Cyrillic, IPA and symbol glyphs. A Latin
page used about a quarter of it, but the whole file competed with the hero
image and JavaScript on mobile connections.

## Entry Points — Read These First

1. `apps/web/src/lib/watch-font.ts`: three `localFont` instances, each with a
   literal `unicode-range` declaration. Only the latin instance preloads and
   owns the metric-adjusted fallback.
2. `apps/web/src/app/globals.css`: `--font-montserrat` chains the three subset
   families ahead of the latin face, its fallback and the native stack.
3. `apps/web/scripts/subset-watch-font.py`: regenerates
   `apps/web/src/fonts/montserrat-{latin,cyrillic,rest}.woff2` from
   `apps/web/public/fonts/Montserrat-VariableFont_wght.woff2` and prints the
   exact ranges.

## Grep These

- `rg -n "font-montserrat" apps/web/src`
- `rg -n "unicode-range" apps/web/src/lib/watch-font.ts`

## What To Build

Delivered:

| File     | Size     | Coverage                                           |
| -------- | -------- | -------------------------------------------------- |
| File     | Size     | Coverage                                           |
| -------- | -------- | -------------------------------------------------- |
| latin    | 66.2 KB  | Google `latin` set plus U+2190-2195 and U+2248     |
| cyrillic | 54.7 KB  | Google `cyrillic` and `cyrillic-ext` sets          |
| rest     | 135.7 KB | every other code point in the source font          |

Every file also holds every combining mark in the font (U+0300-036F and
U+1DC4-1DCA). The script asserts that the three sets together equal the
source font's cmap. Each file keeps `fvar`, `gvar`, `HVAR`, `MVAR`, `avar`,
GSUB, GPOS and the full `name` table.

Correction, 2026-10-20 (round 07 review): the first version put most marks
only in `rest`. The browser shapes a letter and its marks with one font, and
a unicode-range face only "has" the code points in its range. So a cluster
whose base and mark sat in different files matched no Montserrat face and
rendered whole in a system font. Real Chromium showed this for the
production language name "M̧ajeļ" (M + U+0327), decomposed Vietnamese
("TIẾNG" in NFD), Bulgarian stress marks (о + U+0300) and Guarani g̃. The
first version also dropped name IDs 13 and 14, the SIL Open Font License
notice the OFL requires with each copy. Both are fixed; the latin file grew
by 6.9 KB (marks) and 0.2 KB (names).

## Constraints

- Do not declare a shared `font-family` across the instances. Turbopack's
  next/font names the exported family after the JS binding, so the CSS
  variable would point at a family no `@font-face` defines.
- Keep every combining mark in every file. A mark that lives only in another
  file sends its whole letter cluster to a system font.
- Keep the full `name` table (`--name-IDs=*`). It carries the OFL notice.
- Keep only the latin instance preloaded. Keep the other two
  `adjustFontFallback: false` so the single fallback face stays last.
- After changing the source font, re-run the script and paste its ranges.
  next/font only accepts literal options.
- Do not delete `public/fonts/Montserrat-VariableFont_wght.woff2`. The script
  reads it and `watch-url-probe` lists its public path.

## Verification

- `python3 apps/web/scripts/subset-watch-font.py` (requires fonttools) exits 0.
- `next build`, then serve a page with Latin, Cyrillic and Vietnamese text at
  weights 300 to 800. On 2026-10-20 every text span had the same width as the
  single-file build (to 0.01 px), and screenshots matched. A Latin-only page
  loaded only the latin file (57.7 KB, was 200.9 KB).
- Round 07 (2026-10-20), real Chromium 1228: the single full font and the
  subset chain rendered 46 strings (NFC and NFD, weights 500 and 700:
  English, Western European, Spanish, Vietnamese, Russian with stress,
  Bulgarian, Ukrainian, Marshallese, Yoruba, Ewe/Lingala, Guarani, Polish,
  Turkish, Czech, Romanian, Hausa, Navajo, IPA and symbols). DevTools
  `CSS.getPlatformFontsForNode` reported no system-font glyphs on any
  subset string beyond the one the full font also lacks (U+02D0). Pixels
  matched exactly except two known limits: decomposed (NFD) Vietnamese
  stacked marks are drawn by mark positioning rather than the precomposed
  glyph (up to 408 differing pixels at 2x), and kerning between a letter in
  one file and a letter in another is lost (about 1 px per pair, for
  example "Tổ", "Ło"). Google Fonts' own latin/vietnamese split has the same
  kerning trade-off.
- A Latin page that also contains a combining mark (for example the name
  "M̧ajeļ") downloads all three files, because every file lists the marks.
- Matched local `next start` lab, 7 runs, 390x844, 4x CPU, 150 ms RTT,
  1.6 Mbps (medians, no Admin data): `/watch` fonts finished at 1,706 ms
  (was 5,089), load 5,389 ms (was 6,103). FCP, LCP and CLS were flat.
