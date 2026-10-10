---
id: "feat-522"
title: "Keep Watch language search icons visible above the input"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-09-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "languages"
  - "ui"
---

## Problem

The Watch language index search reserves space for its leading search icon, but
the icon can disappear behind the input's composited backdrop-filter layer. The
same overlap can affect the trailing clear button after a query is entered, and
WebKit/Blink can show its native cancel glyph beside that custom control.

## Entry Points — Read These First

1. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx`
2. `apps/web/src/components/watch/WatchLanguageIndexBrowser.test.tsx`
3. `apps/web/src/app/[locale]/[htmlLang]/languages/page.tsx`

## Grep These

- `Search languages or countries`
- `backdrop-blur-[10px]`
- `lucide-search`
- `clearSearch`

## What To Build

- Give the leading search icon and trailing clear button an explicit foreground
  stacking level above the input.
- Suppress the browser-native search cancel decoration so the custom accessible
  clear button is the only trailing icon.
- Add a focused component regression that pins the foreground-layer contract.

## Constraints

- Preserve the search behavior, spacing, localization, and accessible labels.
- Do not change the language index data or filtering rules.

## Verification

- Run the focused `WatchLanguageIndexBrowser` component tests.
- Run Web lint, typecheck, and formatting checks for touched files.
- Render the search control in Chromium and confirm both icons remain visible.

## Completion Notes

- Kept the leading search icon and custom clear control on an explicit
  foreground layer above the backdrop-filtered input.
- Disabled the browser-native search cancel decoration so populated searches
  show one clear control.
- Verified the empty and populated states at a 584px CSS viewport with 2x
  device scale: the search icon and clear button are visible, the native cancel
  appearance is `none`, and the browser console reports no errors.
