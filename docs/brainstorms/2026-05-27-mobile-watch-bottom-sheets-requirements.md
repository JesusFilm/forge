---
date: "2026-05-27"
topic: mobile-watch-bottom-sheets
---

## Summary

Replace the four full-screen modals on the mobile watch page with platform-native bottom sheets and a native share action. Download gets a 75% height sheet; Language and Subtitles become separate half-height sheets with search bars and immediate selection; Share fires the OS share sheet directly. A shared `BottomSheet` wrapper enforces consistent styling across all three sheets.

---

## Problem Frame

The watch page's four action buttons (Download, Language, Subtitles, Share) each open a full-screen `Modal` with a `rgba(0,0,0,0.9)` overlay. This conflicts with both Apple HIG (which recommends `.medium` detent sheets for scoped single-task selection) and Material Design 3 (which recommends modal bottom sheets for finite option lists). Full-screen modals are reserved for immersive content or complex multi-step flows, not simple pickers. The current implementation also duplicates ~1,200 lines of modal boilerplate (close button, overlay, safe area handling) across three files with no shared abstraction.

---

## Key Decisions

**`@gorhom/bottom-sheet` as the sheet foundation.** The de-facto standard for React Native bottom sheets. Gesture-driven, supports multiple snap points, backdrop tap-to-dismiss, and smooth Reanimated-powered animations. Requires adding `react-native-reanimated` and `react-native-gesture-handler` as new dependencies (neither is currently installed).

**Native OS share sheet replaces the custom share UI.** iOS `UIActivityViewController` and Android share intent are what users expect. The custom preview-card + social-buttons UI in `ShareModal.tsx` adds friction and limits share targets to only Facebook and Twitter.

**Language and Subtitles are separate sheets.** The current combined `LanguageSubtitleModal` has a draft-state pattern (select both, then Apply) that adds complexity. Splitting into two sheets with immediate selection simplifies the interaction: tap a row, it takes effect, sheet dismisses.

**Immediate selection, no Apply button.** For Language and Subtitle sheets, tapping a row applies the change and dismisses the sheet. This is the standard pattern for single-select bottom sheet pickers on both platforms.

---

## Requirements

**Sheet infrastructure**

R1. A shared `BottomSheet` wrapper component standardizes backdrop scrim, drag handle, rounded top corners, background color, and dismiss behavior (backdrop tap + swipe down) across all sheets. Uses the app's existing color tokens (`SURFACE_COLOR`, `TEXT_PRIMARY`, etc.) and typography scale.

R2. `@gorhom/bottom-sheet`, `react-native-reanimated`, and `react-native-gesture-handler` are added as dependencies to `apps/mobile`.

R3. The Android back button dismisses any open sheet (via `enablePanDownToClose` + `onRequestClose` equivalent).

**Download sheet**

R4. The Download sheet opens at 75% screen height, showing the poster preview, quality picker, Terms of Use checkbox, and download button without scrolling.

R5. The Terms of Use sub-modal remains a full-screen overlay (it's a legal document that warrants dedicated reading space).

R6. Download sheet content and behavior are otherwise identical to the current `DownloadModal` (quality tiering, ToU gating, `Linking.openURL` for the actual download).

**Language sheet**

R7. The Language sheet opens at half screen height with a search bar at the top.

R8. The language list is searchable by language name. Filtering is instant (as-you-type).

R9. Tapping a language row immediately switches the dub (calls `onLanguageChange`) and dismisses the sheet.

R10. The currently active language is visually distinguished (accent-colored left border or highlight).

**Subtitle sheet**

R11. The Subtitle sheet opens at half screen height with a subtitle on/off toggle at the top and a search bar below it.

R12. When subtitles are toggled off, the list is visually disabled (dimmed, non-interactive).

R13. The subtitle list is searchable by language name with instant filtering.

R14. Tapping a subtitle row immediately activates that subtitle (calls `onSubtitleChange`) and dismisses the sheet.

R15. Toggling subtitles off immediately disables subtitles and dismisses the sheet.

**Share action**

R16. The Share button calls `Share.share()` from React Native with the video URL and title. No custom modal or sheet is rendered.

R17. `ShareModal.tsx` is deleted.

**Cleanup**

R18. `LanguageSubtitleModal.tsx` is deleted and replaced by the two new sheet components.

R19. The watch page (`app/watch/[slug].tsx`) is updated to manage state for three sheets (download, language, subtitles) plus the share action, replacing the current four modal visibility states.

---

## Scope Boundaries

- No offline download manager or download progress tracking.
- No changes to the `ActionButtonRow` layout or icons.
- No changes to modals outside the watch page (e.g., `QuizButtonRenderer`'s modal).
- No migration of the Terms of Use sub-modal to a bottom sheet (it stays full-screen).

---

## Sources / Research

- Apple HIG on Sheets: recommends `.medium` detent for lightweight scoped tasks; full-screen for immersive content only.
- Material Design 3 on Bottom Sheets: modal bottom sheets for finite option lists and share actions.
- Apple HIG on Activity Views: use `UIActivityViewController` as the default for sharing; custom share UIs justified only for specialized workflows.
- Current implementation: `apps/mobile/src/components/watch/DownloadModal.tsx`, `LanguageSubtitleModal.tsx`, `ShareModal.tsx`, `ActionButtonRow.tsx`.
- Design tokens: `apps/mobile/src/lib/color.ts` (warm dark palette), `apps/mobile/src/styles/shared.ts` (spacing), `apps/mobile/src/hooks/useTypography.ts` (responsive type scale).
