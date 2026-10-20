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

| File     | Size     | Coverage                                                    |
| -------- | -------- | ----------------------------------------------------------- |
| latin    | 59.0 KB  | Google `latin` set plus U+2190-2195 and U+2248              |
| cyrillic | 46.5 KB  | Google `cyrillic` and `cyrillic-ext` sets                   |
| rest     | 135.3 KB | every other code point in the source font, plus U+0300-036F |

The script asserts that the three sets together equal the source font's cmap.
Each file keeps `fvar`, `gvar`, `HVAR`, `MVAR`, `avar`, GSUB and GPOS.

## Constraints

- Do not declare a shared `font-family` across the instances. Turbopack's
  next/font names the exported family after the JS binding, so the CSS
  variable would point at a family no `@font-face` defines.
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
- Matched local `next start` lab, 7 runs, 390x844, 4x CPU, 150 ms RTT,
  1.6 Mbps (medians, no Admin data): `/watch` fonts finished at 1,706 ms
  (was 5,089), load 5,389 ms (was 6,103). FCP, LCP and CLS were flat.
