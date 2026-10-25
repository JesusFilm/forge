---
title: "Fix watch subtitle toggle UX"
type: "fix"
status: "complete"
date: "2026-05-29"
roadmap: "feat-035"
---

## Problem

The watch language modal shows a subtitle switch whose on/off state is mostly communicated by thumb position, and the subtitle language dropdown remains visible even when subtitles are switched off. In the dark modal this makes the disabled state feel ambiguous and leaves an inactive control competing with the primary language selector.

## Scope

- Improve the `apps/web/src/components/watch/LanguagePickerModal.tsx` subtitle switch with stronger visual state: distinct on/off track styling, a stable visible state label, and existing `role="switch"` semantics.
- Hide the subtitle `LanguageCombobox` whenever the draft subtitle switch is off or no subtitle options exist.
- Preserve the AI translation request affordance when no subtitles exist.
- Update localized `LanguagePickerModal` message catalogs only for the new short state labels.
- Keep subtitle persistence, language navigation, data fetching, and player rendering behavior unchanged.

## Implementation Notes

`LanguagePickerModal` already owns the subtitle draft state and selector rendering. The change should keep the existing `draftSubtitleEnabled` flow: users can toggle on to reveal the selector, toggle off to hide it, and Apply continues to call `onSubtitleChange` without navigating when only subtitle state changes.

## Verification

- Passed: `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- Passed: `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts`
- Passed: `pnpm --filter @forge/web typecheck`
- Passed: `pnpm --filter @forge/web lint`
- Attempted browser smoke against a temporary local harness, but the broad watch route/proxy resolved the harness through the live watch page and hit missing local admin GraphQL data. The temporary harness was removed.
