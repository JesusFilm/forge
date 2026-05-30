---
title: "feat: Replace watch page modals with bottom sheets"
type: feat
status: active
date: "2026-05-27"
origin: docs/brainstorms/2026-05-27-mobile-watch-bottom-sheets-requirements.md
---

# feat: Replace watch page modals with bottom sheets

## Summary

Replace the four full-screen modals on the mobile watch page — Download, Language, Subtitles, and Share — with three platform-native bottom sheets and a native OS share dialog. Install `@gorhom/bottom-sheet` with its peer dependencies, create a shared styled wrapper, then migrate Download, Language, and Subtitles to bottom sheets while Share switches to the OS share dialog.

---

## Problem Frame

The watch page's four action buttons each open a full-screen `Modal` with an opaque overlay. This violates both Apple HIG (`.medium` detent for scoped selection) and Material Design 3 (modal bottom sheets for finite option lists). The three modal files duplicate ~1,200 lines of boilerplate (close button, overlay, safe area handling) with no shared abstraction. (see origin: `docs/brainstorms/2026-05-27-mobile-watch-bottom-sheets-requirements.md`)

---

## Requirements

**Sheet infrastructure**

R1. A shared `BottomSheet` wrapper standardizes backdrop scrim, drag handle, rounded top corners, background color, and dismiss behavior across all sheets. Uses existing color tokens and typography scale.

R2. `@gorhom/bottom-sheet`, `react-native-reanimated`, and `react-native-gesture-handler` are added as dependencies.

R3. The Android back button dismisses any open sheet.

**Download sheet**

R4. The Download sheet opens at 75% screen height showing poster, quality picker, Terms of Use checkbox, and download button.

R5. The Terms of Use sub-modal remains a full-screen overlay.

R6. Download sheet content and behavior are identical to the current `DownloadModal`.

**Language sheet**

R7. The Language sheet opens at half screen height with a search bar at the top.

R8. The language list is searchable by name with instant filtering.

R9. Tapping a language row immediately switches the dub and dismisses the sheet.

R10. The active language is visually distinguished.

**Subtitle sheet**

R11. The Subtitle sheet opens at half screen height with an on/off toggle and a search bar.

R12. When subtitles are toggled off, the list is dimmed and non-interactive.

R13. The subtitle list is searchable by name with instant filtering.

R14. Tapping a subtitle row immediately activates that subtitle and dismisses the sheet.

R15. Toggling subtitles off immediately disables subtitles and dismisses the sheet.

**Share action**

R16. The Share button calls `Share.share()` with the video URL and title.

R17. `ShareModal.tsx` is deleted.

**Cleanup**

R18. `LanguageSubtitleModal.tsx` is deleted.

R19. The watch page manages state for three sheets plus the share action.

---

## Key Technical Decisions

**`@gorhom/bottom-sheet` v5 as the sheet foundation:** De-facto standard for React Native. Gesture-driven, multiple snap points, backdrop tap-to-dismiss, Reanimated-powered. Peer dep versions are resolved by `npx expo install` per SDK 54 compatibility (currently `react-native-reanimated@~4.1.1` and `react-native-gesture-handler@~2.28.0`). Reanimated v4 also pulls in `react-native-worklets` as an additional peer dependency (auto-resolved by `npx expo install`). Requires a full EAS native build (cannot ship via OTA update).

**`GestureHandlerRootView` wraps the entire app in root layout:** `react-native-gesture-handler` requires this wrapper at the top of the component tree. It goes around `ErrorBoundary` > `ApolloProvider` > ... > `Stack` in `app/_layout.tsx`. The existing defensive `require()` pattern in root layout applies to this import too.

**Ref-based sheet control instead of boolean state:** Replace `useState<boolean>` modal visibility flags with `useRef<BottomSheet>` refs. Open sheets via `ref.current?.expand()`, close via `ref.current?.close()`. Sheets stay mounted (closed at snap index -1) instead of the current mount/unmount pattern, which avoids remount cost for the download sheet's state.

**`BottomSheetScrollView` for scrollable sheet content:** `@gorhom/bottom-sheet` provides its own ScrollView that properly coordinates sheet drag gestures with content scrolling. Language and subtitle lists use this. The download sheet uses `BottomSheetScrollView` defensively (the existing `DownloadModal` uses a `ScrollView` because content may overflow on smaller screens).

**Search uses `BottomSheetTextInput` for keyboard handling:** `@gorhom/bottom-sheet` provides a `BottomSheetTextInput` that handles keyboard avoidance within sheets. The language and subtitle search bars use this instead of RN's `TextInput`.

---

## Scope Boundaries

- No offline download manager or download progress tracking.
- No changes to `ActionButtonRow` layout or icons.
- No changes to modals outside the watch page (e.g., `QuizButtonRenderer`).
- Terms of Use sub-modal stays full-screen.

### Deferred to Follow-Up Work

- Migrate other app modals to bottom sheets if this pattern proves successful.
- Add haptic feedback on sheet snap.

---

## Implementation Units

### U1. Install dependencies and configure build tooling

**Goal:** Add `@gorhom/bottom-sheet` and its peer dependencies, configure Babel and Jest, wrap the app in `GestureHandlerRootView`.

**Requirements:** R2

**Dependencies:** None

**Files:**

- `apps/mobile/package.json`
- `apps/mobile/babel.config.js`
- `apps/mobile/app/_layout.tsx`

**Approach:**

- Install via `npx expo install @gorhom/bottom-sheet react-native-reanimated react-native-gesture-handler` to pin Expo SDK 54-compatible versions.
- Add a `plugins` key to `babel.config.js` (none exists currently): `plugins: ["react-native-reanimated/plugin"]`. If other plugins are added later, Reanimated must remain last.
- Update `jest` config in `package.json`: add `react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`, and `@gorhom/bottom-sheet` to `transformIgnorePatterns`.
- In `app/_layout.tsx`, import `GestureHandlerRootView` from `react-native-gesture-handler` inside the existing try/catch `require()` block. Wrap the component tree: `<GestureHandlerRootView style={{flex: 1}}>` as the outermost wrapper inside `RootLayout`, around `ErrorBoundary`.

**Patterns to follow:**

- The defensive `require()` import pattern in `app/_layout.tsx` (lines 23-41) — add `GestureHandlerRootView` to the same try/catch block.
- `transformIgnorePatterns` already lists several RN packages — follow the same exclusion pattern.

**Test scenarios:**

- App launches without crash on iOS simulator after adding deps and babel plugin.
- App launches without crash on Android emulator.
- Metro bundler starts without errors.
- Existing tests pass with updated Jest config.

**Verification:** `npx expo start` launches, existing watch page modals still function (they haven't been replaced yet).

---

### U2. Create shared BottomSheet wrapper component

**Goal:** Build a reusable `BottomSheet` wrapper that standardizes visual styling and dismiss behavior for all three content sheets.

**Requirements:** R1, R3

**Dependencies:** U1

**Files:**

- `apps/mobile/src/components/ui/BottomSheet.tsx` (create)

**Approach:**

- Wraps `@gorhom/bottom-sheet`'s `BottomSheet` component with pre-configured props:
  - `backgroundStyle`: `backgroundColor: SURFACE_COLOR`, `borderTopLeftRadius: 16`, `borderTopRightRadius: 16`
  - `handleIndicatorStyle`: `backgroundColor: TEXT_SECONDARY`, `width: 40`
  - `backdropComponent`: `BottomSheetBackdrop` with `opacity: 0.7`, `appearsOnIndex: 0`, `disappearsOnIndex: -1`, `pressBehavior: "close"`
  - `enablePanDownToClose: true` (enables swipe-to-close AND implicitly activates the library's internal `BackHandler` subscription on Android, satisfying R3)
  - `enableDynamicSizing: false` (use explicit snap points)
  - `index: -1` (start closed)
  - `keyboardBehavior: "extend"` and `keyboardBlurBehavior: "restore"` for iOS keyboard handling (extends sheet height to accommodate keyboard rather than shifting the entire sheet up)
  - `android_keyboardInputMode: "adjustResize"` for Android keyboard handling
- Accept `snapPoints` as a required prop (sheets define their own heights).
- Accept `children` for sheet content.
- Forward ref so the watch page can call `expand()` / `close()`.
- Use `useTypography()` and color tokens from `src/lib/color.ts`.

**Patterns to follow:**

- Color tokens from `src/lib/color.ts` (`SURFACE_COLOR` for sheet background, `TEXT_SECONDARY` for handle).
- `HORIZONTAL_PADDING` from `src/styles/shared.ts` for default content padding.
- `feedback.pressed` for any pressable elements within the sheet.

**Test scenarios:**

- Sheet renders closed (invisible) when `index` is -1.
- Sheet opens to the specified snap point when `expand()` is called.
- Tapping the backdrop closes the sheet.
- Swiping down closes the sheet.
- Android back button closes the sheet.
- Sheet uses `SURFACE_COLOR` background and `TEXT_SECONDARY` handle indicator.

**Verification:** Import and render a test sheet on the watch page with a placeholder "Hello" content to verify the wrapper works before building real content.

---

### U3. Replace share action with native Share.share()

**Goal:** Remove the custom share modal and fire the OS share sheet directly from the Share button.

**Requirements:** R16, R17

**Dependencies:** None (independent of U1/U2)

**Files:**

- `apps/mobile/app/watch/[slug].tsx`
- `apps/mobile/src/components/watch/ShareModal.tsx` (delete)

**Approach:**

- In the watch page, replace the `ShareModal` import and `shareModalVisible` state with a `handleShare` callback that calls `Share.share({ message: shareUrl, title: videoTitle })` using RN's built-in `Share` API. The `buildShareUrl` helper can be inlined or extracted to a small utility.
- Remove the `{shareModalVisible && <ShareModal ... />}` block.
- Delete `ShareModal.tsx` entirely. The custom copy-link feature in `ShareModal.tsx` is intentionally removed — the OS share sheet includes a native copy action on both platforms, making the custom clipboard implementation redundant.

**Patterns to follow:**

- `buildShareUrl()` logic from the existing `ShareModal.tsx` (lines 39-43) — keep the same URL format: `https://www.jesusfilm.org/watch/${videoSlug}/${languageSlug}`.

**Test scenarios:**

- Tapping the Share button opens the native OS share dialog on iOS.
- Tapping the Share button opens the native share intent on Android.
- The shared URL includes the video slug and language slug.
- The share title is the video title.
- Dismissing the native share dialog returns to the watch page cleanly.

**Verification:** Tap Share on the watch page in both iOS simulator and Android emulator; OS share sheet appears with the correct URL.

---

### U4. Build Download bottom sheet

**Goal:** Replace `DownloadModal` with a bottom sheet that opens at 75% height, preserving all existing download behavior.

**Requirements:** R4, R5, R6

**Dependencies:** U2

**Files:**

- `apps/mobile/src/components/watch/DownloadSheet.tsx` (create)
- `apps/mobile/src/components/watch/DownloadModal.tsx` (delete)
- `apps/mobile/app/watch/[slug].tsx`

**Approach:**

- Create `DownloadSheet.tsx` that renders inside the shared `BottomSheet` wrapper with `snapPoints={["75%"]}`.
- Port content from `DownloadModal`: poster preview, quality picker (`FlatList` of tiered downloads), Terms of Use checkbox, download button. Use `BottomSheetScrollView` (the existing modal uses `ScrollView` because content may overflow on smaller devices like iPhone SE).
- Keep the nested `TermsModal` as a standard RN `Modal` — it stacks on top of the sheet cleanly (R5).
- Keep all existing logic: `tierDownloads`, `formatDuration`, `formatFileSize`, `touAccepted` gating, `Linking.openURL` download, empty-state rendering.
- Reset transient state when the sheet opens: listen to the sheet's `onChange` callback and reset `selectedIndex` to 0, `touAccepted` to false, and clear the search query when the snap index transitions from -1 to >= 0. This preserves the current mount/unmount reset behavior under the new mounted-at-index-minus-1 pattern (matching `LanguageSubtitleModal.tsx` lines 86-92 reset-on-open prior art).
- Remove the close button (replaced by the sheet's drag handle and backdrop dismiss).
- Remove the overlay (`modalOverlay`) and safe-area-top padding (the sheet handles its own positioning).
- In the watch page, replace `downloadModalVisible` boolean with a `useRef<BottomSheet>(null)` ref. `ActionButtonRow.onDownload` calls `downloadSheetRef.current?.expand()`.

**Patterns to follow:**

- Quality row selection pattern from `DownloadModal.tsx` (radio selection with accent highlight).
- `feedback.pressed` for pressable interactions.
- `useTypography()` for all text.

**Test scenarios:**

- Download sheet opens at 75% height when Download button is tapped.
- Poster, video title, and language pill are displayed.
- Quality tiers (Highest/High/Low) render with correct file sizes.
- Tapping a quality row selects it (accent highlight).
- Terms of Use checkbox opens the full-screen Terms modal.
- Accepting terms enables the Download button.
- Tapping Download opens the URL via `Linking.openURL`.
- Empty state shows "No downloads available" message.
- Swiping down or tapping backdrop dismisses the sheet.
- Terms modal renders correctly on top of the sheet.
- Closing and reopening the sheet resets quality selection and terms acceptance.

**Verification:** Open the download sheet, select a quality, accept terms, tap download — URL opens in browser. Verify Terms modal stacks properly.

---

### U5. Build Language bottom sheet

**Goal:** Create a standalone language picker sheet with search and immediate selection.

**Requirements:** R7, R8, R9, R10

**Dependencies:** U2

**Files:**

- `apps/mobile/src/components/watch/LanguageSheet.tsx` (create)
- `apps/mobile/app/watch/[slug].tsx`

**Approach:**

- Create `LanguageSheet.tsx` with `snapPoints={["50%"]}`.
- Layout: `BottomSheetTextInput` search bar at the top, `BottomSheetScrollView` language list below.
- Search filters the language list by name (case-insensitive, as-you-type). Use a local `useState<string>` for the query and `useMemo` to filter `sortedVariants`.
- Each row shows the language name. The active language has an accent-colored left border (same pattern as the current `LanguageSubtitleModal`'s `listRowActive` style with `borderLeftColor: ACCENT`).
- Tapping a row: guard that `variant.hls` is truthy before calling `onLanguageChange(slug, hlsUrl)` (matching the null guard at `LanguageSubtitleModal.tsx` line 105), then call the sheet's `close()` method. The close is optimistic — the watch page handles any stream switch error; the sheet does not wait for acknowledgment. No Apply button, no draft state.
- The active-language highlight is driven by the `activeVariantSlug` prop (not local state), so it persists correctly across search state changes.
- Reset the search query when the sheet opens via the `onChange` callback (same pattern as U4).
- Port `resolveLanguageName()` and `sortedVariants()` helpers from `LanguageSubtitleModal.tsx`.
- `BottomSheetScrollView` must receive `contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}` via `useSafeAreaInsets` to prevent the last row from being clipped by the home indicator.
- In the watch page, add a `languageSheetRef` and wire `ActionButtonRow.onLanguage` to `expand()`.

**Patterns to follow:**

- `listRow` / `listRowActive` styles from `LanguageSubtitleModal.tsx` (accent left border, subtle background on active).
- `resolveLanguageName()` using `pickLocalizedName()` from `src/lib/pickLocalizedName.ts`.

**Test scenarios:**

- Language sheet opens at half height when Language button is tapped.
- All available languages are listed alphabetically.
- Typing in the search bar filters the list instantly.
- The currently active language is visually highlighted with an accent border.
- Tapping a language row switches the dub immediately (video stream changes).
- The sheet closes after a language is selected.
- Searching for a non-existent language shows an empty list (no crash).
- Clearing the search bar restores the full list.
- Closing and reopening the sheet clears the search query.
- On iOS, the keyboard extends the sheet rather than shifting it up.

**Verification:** Open the language sheet, search for a language, tap it — video switches to that dub and sheet dismisses.

---

### U6. Build Subtitle bottom sheet and delete old modal

**Goal:** Create a standalone subtitle picker sheet with toggle, search, and immediate selection. Delete the old combined `LanguageSubtitleModal`.

**Requirements:** R11, R12, R13, R14, R15, R18, R19

**Dependencies:** U2

**Files:**

- `apps/mobile/src/components/watch/SubtitleSheet.tsx` (create)
- `apps/mobile/src/components/watch/LanguageSubtitleModal.tsx` (delete)
- `apps/mobile/app/watch/[slug].tsx`

**Approach:**

- Create `SubtitleSheet.tsx` with `snapPoints={["50%"]}`.
- Layout: subtitle on/off `Switch` toggle at the top (same pattern as current modal), `BottomSheetTextInput` search bar below, `BottomSheetScrollView` subtitle list.
- When toggle is off: list is dimmed (`opacity: 0.5`) and non-interactive (`pointerEvents: "none"`), matching the current `listDisabled` pattern.
- Toggling off: calls `onSubtitleChange(false, null)` immediately and closes the sheet (R15).
- Toggling ON does NOT immediately call `onSubtitleChange` — it only restores list interactivity so the user can pick a language. `onSubtitleChange` fires only when a row is tapped (R14). If the user swipes the sheet away after toggling on without selecting a row, the toggle state reverts (toggle is local to the sheet until a row selection commits it).
- Each row shows the subtitle language name. Active subtitle has the accent-colored left border.
- Tapping a row: calls `onSubtitleChange(true, slug)` immediately and closes the sheet (R14).
- Search filters the subtitle list by name (same pattern as language sheet).
- If `subtitles` is an empty array, the sheet shows an empty state message ("No subtitles available" with an Ionicons speech-bubble-outline icon at `TEXT_SECONDARY`, matching the Download sheet's empty state pattern). The toggle and search bar are hidden in this state.
- `BottomSheetScrollView` must receive `contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}` via `useSafeAreaInsets` (same as language sheet).
- Reset the search query and local toggle state when the sheet opens via the `onChange` callback.
- Port `sortedSubtitles()` helper from `LanguageSubtitleModal.tsx`.
- In the watch page: add `subtitleSheetRef`, wire `ActionButtonRow.onSubtitles` to `expand()`, remove `languageModalVisible` state and the `LanguageSubtitleModal` import. Ensure subtitle state (`subtitleEnabled`, `activeSubtitleSlug`) is managed at the watch page level.
- Delete `LanguageSubtitleModal.tsx`.
- U5 and U6 should land in the same PR so the combined `LanguageSubtitleModal` is replaced atomically.

**Patterns to follow:**

- Subtitle toggle uses RN `Switch` with `trackColor={{ false: SURFACE_COLOR, true: ACCENT }}` (from current modal).
- List disabled pattern: `opacity: 0.5` + `pointerEvents: "none"` (from current `listDisabled` style).

**Test scenarios:**

- Subtitle sheet opens at half height when Subtitles button is tapped.
- Subtitle toggle shows the current subtitle state (on/off).
- When subtitles are on, all available subtitles are listed alphabetically.
- Typing in the search bar filters subtitles instantly.
- The active subtitle is visually highlighted.
- Tapping a subtitle row activates it immediately and closes the sheet.
- Toggling subtitles off disables subtitles immediately and closes the sheet.
- When subtitles are toggled off, the list is visually dimmed and taps are ignored.
- Searching for a non-existent subtitle shows an empty list.
- When `subtitles` array is empty, the sheet shows an empty state message (no toggle, no search bar).
- Toggling ON without selecting a row and then dismissing the sheet does not commit the toggle change.
- The old `LanguageSubtitleModal.tsx` is deleted and no longer imported anywhere.

**Verification:** Open subtitle sheet, toggle on, search and select a subtitle — subtitle activates and sheet closes. Toggle off — subtitles disable and sheet closes. Verify `LanguageSubtitleModal.tsx` is gone from the codebase.

---

## Risks & Dependencies

**EAS native build required:** Adding `react-native-reanimated` and `react-native-gesture-handler` means this change cannot ship via EAS Update (OTA). A full native build across development, preview, and production profiles is required. Plan EAS builds before merging.

**Babel plugin ordering:** The `react-native-reanimated/plugin` must be the last plugin in the Babel config. Incorrect ordering causes cryptic build failures.

**Gesture conflict with existing scroll views:** The watch page has a `ScrollView` as its main content. `@gorhom/bottom-sheet` handles gesture coordination internally, but if any custom `PanResponder` or gesture handling exists on the page, it could conflict. Current codebase uses only `onScroll` callbacks, which should be fine.

---

## Sources / Research

- `@gorhom/bottom-sheet` v5 docs — snap points, `BottomSheetScrollView`, `BottomSheetTextInput`, `BottomSheetBackdrop`.
- `docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md` — z-index vs touch priority; `@gorhom/bottom-sheet` uses a portal pattern that avoids this.
- `docs/solutions/mobile/quiz-button-section-webview-modal-pipeline.md` — native module additions require EAS native build; Jest `transformIgnorePatterns` must be updated in the same commit.
- `docs/solutions/best-practices/mobile-video-detail-page-patterns-20260527.md` — mounted-vs-visible animation pattern; `@gorhom/bottom-sheet` keeps sheets mounted at index -1, which aligns with this.
- Current implementation: `apps/mobile/src/components/watch/DownloadModal.tsx`, `LanguageSubtitleModal.tsx`, `ShareModal.tsx`, `ActionButtonRow.tsx`.
- Design tokens: `apps/mobile/src/lib/color.ts`, `apps/mobile/src/styles/shared.ts`, `apps/mobile/src/hooks/useTypography.ts`.
