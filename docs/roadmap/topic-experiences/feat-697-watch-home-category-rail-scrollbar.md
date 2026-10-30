---
id: "feat-697"
title: "Hide the Watch home category rail scrollbar"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-14"
duration: 1
depends_on: []
blocks: []
tags: [web, watch, ui]
---

## Problem

The Watch home category rail uses native horizontal scrolling below 1440px,
but exposes the browser scrollbar beneath its cards. The scrollbar is visible
in production and adds an unintended bar across the section.

## Entry Point

- `apps/web/src/components/home/WatchHomeCategoryRail.tsx`

## What To Build

Hide the native scrollbar across browsers while preserving native scrolling,
scroll snapping, links, and the existing arrow controls. Keep the wide-screen
grid behavior.

## Verification

- Inspect the production scroller's computed overflow and scrollbar styles.
- Check the affected viewport in a real browser after the change.
- Run the focused Web component tests, typecheck, lint, and formatting checks.

## Result

The rail now hides its scrollbar with `scrollbar-width: none` and a WebKit
scrollbar rule. A browser check at 1280px confirmed `overflow-x: auto` still
allows scrolling after the equivalent rules were applied. The focused component
suite passed (54 tests), as did Web typecheck, ESLint, and Prettier.
