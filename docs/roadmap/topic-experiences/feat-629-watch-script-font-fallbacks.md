---
id: "feat-629"
title: "Add script-aware Watch font fallbacks"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
  - "performance"
---

## Problem

Watch currently declares a Latin-only fallback stack. On devices without the
requested writing system, non-Latin Watch pages can render with inconsistent
metrics or missing glyphs. Linear: FGE-181.

## What To Build

- Add local, licensed Noto subsets for Arabic, Hebrew, Devanagari, Thai, and
  Ethiopic with explicit Unicode ranges and append script-appropriate Noto
  families to the shared native fallback stack.
- Preload only the single subset selected from the resolved document
  `htmlLang`; Latin pages must not request an extra script font.
- CJK stays on the platform fallback stack in this change. Its multi-subset
  local font coverage is tracked separately in feat-630 because its asset and
  request cost needs its own measurement.

## Entry Points

1. `apps/web/src/lib/watch-font.ts`
2. `apps/web/src/app/globals.css`
3. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
4. `apps/web/public/fonts/`

## Verification

- Verify script selection for Arabic, Hebrew, Devanagari, Thai, and Ethiopic
  document tags, plus no preload for Latin and unsupported scripts.
- Compare document resource requests for Latin and script-specific pages; only
  the matching subset should be preloaded.
- Run Web typecheck, focused layout tests, lint, and format checks.
