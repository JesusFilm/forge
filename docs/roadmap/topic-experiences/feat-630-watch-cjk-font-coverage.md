---
id: "feat-630"
title: "Measure local CJK font coverage for Watch"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-07"
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
  - "performance"
---

## Problem

Watch's Latin and script-specific fallback chain does not bundle local CJK
fonts. The OS may provide a suitable Noto font, but that is not guaranteed and
the current names can select Japanese glyph forms for Chinese pages. Linear:
FGE-181 follow-up.

## What To Build

- Measure representative Japanese, Simplified Chinese, Traditional Chinese,
  and Korean page strings against local subset options and platform fallbacks.
- Compare bundle size, request count, page-load timing, glyph coverage, and
  locale-specific glyph forms before choosing local files or platform-only
  behavior.
- Preload no more than the useful subset for the resolved language and avoid
  fetching unrelated script data.

## Entry Points

1. `apps/web/src/app/globals.css`
2. `apps/web/src/lib/watch-script-font.ts`
3. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
4. `apps/web/public/fonts/`

## Grep These

- `Noto Sans JP`
- `unicode-range`
- `WATCH_BASE_PATH`
- `LargestContentfulPaint`

## Constraints

- Do not ship a full CJK font file or hundreds of unmeasured subsets by
  default.
- Preserve region-specific glyph shapes for Japanese, Simplified Chinese,
  Traditional Chinese, and Korean.
- Keep non-CJK routes free of CJK font requests.

## Verification

- Capture network and timing evidence for representative Latin and CJK pages.
- Confirm glyph coverage and language-specific rendering on each target script.
- Run Web typecheck, tests, lint, and format checks.
