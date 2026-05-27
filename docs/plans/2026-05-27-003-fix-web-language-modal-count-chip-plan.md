---
title: Web language modal count chip polish
type: fix
status: complete
date: 2026-05-27
origin: docs/roadmap/topic-experiences/feat-144-web-language-modal-count-chip-polish.md
---

# Web language modal count chip polish

## Problem Frame

The web watch language modal already supports audio-language selection and
subtitle selection. Its current section counts are right-aligned descriptive
text (`"N languages"`), and the subtitle switch sits beside the "Subtitles"
heading. The requested polish is visual and localized: counts should become
number-only chips immediately following their titles, and the subtitle switch
should move to the right-side controls.

## Scope

In scope:

- `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- `docs/roadmap/topic-experiences/feat-144-web-language-modal-count-chip-polish.md`

Out of scope:

- Language routing, saved language preference cookies, subtitle rendering, and
  translation request behavior.
- Changes to `LanguageCombobox`, `WatchPageClient`, or player chrome.
- New shared design primitives.

## Requirements Trace

- R1. Language count appears immediately after the "Language" title.
- R2. Language count chip text is numeric only.
- R3. Subtitle count chip appears immediately after the "Subtitles" title.
- R4. Subtitle switch moves to the right-side control cluster.
- R5. Existing disabled, dirty-state, Apply, Close, and translation request
  behavior remains unchanged.

## Existing Patterns

- `LanguagePickerModal.tsx` already owns all relevant layout, count, and switch
  markup.
- `LanguagePickerModal.test.tsx` uses `data-testid` selectors and class/text
  assertions for modal shell details.
- The modal uses Tailwind utility classes directly for this surface; a new
  shared chip component would be unnecessary for this one-off polish.

## Implementation Units

### U1. Count Chips And Subtitle Switch Placement

Files:

- Modify `apps/web/src/components/watch/LanguagePickerModal.tsx`
- Modify `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`

Approach:

1. Change the language section header to group the `Language` heading and
   `watch-language-picker-count` chip in the left-side title cluster.
2. Replace the language count text with `options.length`.
3. Change the subtitle section header to group the `Subtitles` heading and
   `watch-language-picker-subtitle-count` chip in the left-side title cluster.
4. Move `watch-language-picker-subtitles-toggle` into the right-side cluster,
   alongside the optional AI translation request button.
5. Keep `watch-language-picker-count` and
   `watch-language-picker-subtitle-count` test IDs on the chip elements so
   existing selectors remain stable.

Test scenarios:

- Header count test expects language count text `"3"` and chip classes.
- Subtitle shell test expects subtitle count text `"1"` and confirms the
  subtitle switch is inside the right-side control cluster, not the title
  cluster.
- No behavioral navigation or subtitle callback tests should change.

## Verification

- `pnpm --filter @forge/web test src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke on a watch page language modal at mobile width if local web
  boot is practical in the current environment.
