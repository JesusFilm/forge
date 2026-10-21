---
id: "feat-782"
title: "Watch download dialog text budget and quality popup placement"
owner: "vlad"
priority: "P3"
status: "not-started"
start_date: "2026-10-22"
duration: 2
depends_on:
  - "feat-457"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "responsive-ui"
  - "accessibility"
  - "modal"
---

## Problem

The independent acceptance of PR 2836 (feat-457) found three small problems in
the Watch download dialogs. None of them blocks that PR. All three are text and
popup behavior at small sizes or large text.

1. **Narrow text budget at 320px with 200% text.** In the collection dialog,
   the selected language name splits inside a word ("Portuguese," and
   "Standard"). The name area is about 143px wide. The dialog viewport padding
   (`p-4`, rem-based), the content padding and the select padding use most of
   the width. All text is painted and nothing is clipped, but the result is
   hard to read. The earlier fix in PR 2836 replaced truncation with wrapping,
   so this is a result of that fix and not a change from `main`.
2. **The quality popup opens only downward.** `TierListbox` places the list at
   the bottom of its trigger. It does not flip above the trigger and does not
   limit its height to the viewport. On a 480px tall viewport with the trigger
   low on the screen, the last tiers are below the fold. The keyboard keys End
   and Enter still work, and scrolling still works. The plan for the collection
   quality listbox deferred this.
3. **The native-language name does not scale with text.** In the language
   trigger, the second line uses `sm:text-xs` or `sm:text-[11px]`. At 32px root
   font size, the selected name is 28px and this line stays at 11px.

## Entry Points - Read These First

1. `apps/web/src/components/watch/CollectionDownloadModal.tsx` - field grid,
   content padding and the trigger class names that make the name wrap.
2. `apps/web/src/components/ui/dialog.tsx` and
   `apps/web/src/components/watch/watch-modal-presentation.ts` - the viewport
   padding that the dialog shares.
3. `apps/web/src/components/watch/TierListbox.tsx` - `updateRect`, which sets
   the popup position from the trigger bottom.
4. `apps/web/src/components/watch/LanguageCombobox.tsx` - the
   `language-combobox-trigger-native` element and its font size classes.
5. `apps/web/e2e/watch-collection-download-fields.spec.ts` - the browser
   regression spec. It allows broken words below 640px on purpose. Tighten that
   rule when item 1 is fixed.
6. `todos/025-pending-p3-download-modal-migrate-to-tier-listbox.md` - the film
   quality picker migration. Item 2 shares the `TierListbox` code that this
   todo moves the film dialog onto.

## Grep These

- `POPUP_GAP_PX`
- `language-combobox-trigger-native`
- `@min-[36rem]:grid-cols-2`
- `[overflow-wrap:anywhere]`
- `brokenWords`

## What To Build

1. Give the collection dialog a text budget at 320px with 200% text so that a
   long language name stays whole on its line, or wraps only at spaces. Measure
   the result in a browser. Do not replace wrapping with truncation.
2. Place the `TierListbox` popup above the trigger when there is not enough
   room below. Limit its height to the free space and let it scroll. Keep
   Escape, outside click, focus return and the keyboard model as they are.
3. Size the native-language name in `rem`, so that it grows with the root font
   size, and keep the compact variant smaller than the primary name.

## Constraints

- Do not change download, authentication or consent behavior.
- Do not change the close-button clearance, the Terms focus trap or the Escape
  order that feat-457 accepted.
- Do not show file sizes (feat-310 decision stands).
- Keep `TierListbox` as the single owner of popup placement for both download
  dialogs. Do not add a second copy to `DownloadModal.tsx`.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch`
- `watch-collection-download-fields.spec.ts` against a production build:
  320x844 at 32px root font shows no broken word in the selected language name.
- Browser, 640x480 at 32px root font, trigger low on the page: the quality list
  opens inside the viewport and every tier is reachable by pointer and keyboard.
- Browser, 32px root font: the native-language line is larger than 11px.
- Page load: check that the change adds no new request and no new JavaScript
  beyond a few bytes, because the dialogs load on demand.
