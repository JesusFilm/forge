---
title: "Unicode-range font subsets must carry every combining mark, and keep the OFL notice"
date: "2026-10-20"
category: ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "Language names such as 'M̧ajeļ' render partly in a system font after a font split"
  - "Decomposed (NFD) Vietnamese and Cyrillic letters with marks fall back or detach"
  - "Subset font files no longer contain the SIL OFL licence text"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - watch-font.ts
  - subset-watch-font.py
tags:
  - fonts
  - unicode-range
  - combining-marks
  - i18n
  - licence
  - performance
---

## Problem

PR #2834 split Watch's Montserrat into `latin`, `cyrillic` and `rest`
files with `unicode-range`. Only `latin` is preloaded, so Latin pages
load 64.6 KB instead of 200.9 KB. The first version had two defects that
a cmap coverage check could not catch.

1. **Clusters fell back to a system font.** A browser shapes a base
   letter and its marks with one font. A `unicode-range` face only "has"
   code points in its range. Combining marks (U+0300–036F) were only in
   `rest`, so a Latin or Cyrillic base followed by a mark matched no
   Montserrat face, and the whole cluster rendered in the native stack.
   Real case: "M̧ajeļ" (M + U+0327) from the live `/watch/languages`
   page. Decomposed Vietnamese, Bulgarian о + U+0300 and Guarani g̃ had
   the same problem.
2. **The licence notice was stripped.** By default, `pyftsubset` drops
   name IDs 13 and 14 (OFL text and URL), and `apps/web` ships no
   `OFL.txt`.

## Fix

- Add `cmap & (U+0300–036F | U+1DC0–1DFF)` to every subset, then
  regenerate the ranges.
- Pass `--name-IDs=*` to keep the full `name` table (+0.2 KB).

## How to verify

- In a real browser, render each test string with the full font and with
  the subset chain. Read `CSS.getPlatformFontsForNode` for every node: no
  system font may appear. Pixel-diff at an integer line height.
- Use real strings: language names harvested from production, in both NFC
  and NFD, at the weights in use.
- Test failure paths too: all fonts blocked, and only some subsets blocked.

## Trade-offs to state, not hide

- A Latin page with any combining mark now loads all three files (about
  250 KB).
- A mixed-script page can also load all three.
- A Russian page loads about 103 KB and a Vietnamese page about 190 KB.
- Kerning across two files is lost, about 1 CSS px per pair.
- Only Chromium was checked. WebKit and Firefox still need a pass.
- Not every locale gets faster. Report per-script costs, not one headline
  number.

## References

PR #2834 (feat-769) and `docs/reports/2026-10-20-watch-overnight-audit.md`.
