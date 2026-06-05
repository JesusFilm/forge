---
title: "Bottom sheet migration pitfalls in Expo SDK 54 with @gorhom/bottom-sheet"
date: "2026-05-27"
last_updated: "2026-06-05"
category: best-practices
module: apps/mobile
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "Migrating React Native full-screen modals to @gorhom/bottom-sheet"
  - "Upgrading expo-file-system from v18 to v19"
  - "Adding a download-and-share flow in React Native"
  - "Using bottom sheets with multiple snap points and scrollable content"
  - "Adding react-native-gesture-handler to an Expo managed workflow app"
tags:
  - react-native
  - expo
  - bottom-sheet
  - gorhom
  - expo-file-system
  - gesture-handler
  - reanimated
  - mobile
  - download
related_components:
  - apps/mobile/src/components/watch/DownloadSheet.tsx
  - apps/mobile/src/components/watch/LanguageSheet.tsx
  - apps/mobile/src/components/watch/SubtitleSheet.tsx
  - apps/mobile/app/_layout.tsx
  - apps/mobile/app/watch/[slug].tsx
---

# Bottom sheet migration pitfalls in Expo SDK 54 with @gorhom/bottom-sheet

> **Status update (2026-06-05):** the watch sheets (Language / Subtitle / Download) were migrated OFF `@gorhom/bottom-sheet` to **native formSheet** (`react-native-screens`, `presentation: "formSheet"`) shortly after this doc was written. `@gorhom/bottom-sheet` and `react-native-gesture-handler` are no longer dependencies, and `BottomSheet.tsx` was removed. So the `@gorhom`-specific pitfalls below — **#1** (GestureHandlerRootView), **#2** (onChange-on-every-snap), **#3** (enableContentPanningGesture), and **#9** (BottomSheetFlatList) — no longer describe the current sheets; keep them only as reference if you adopt `@gorhom` elsewhere. The **library-independent** pitfalls still apply to the current native `DownloadSheet.tsx`: **#4–#6** (expo-file-system v19 legacy API + null guard + documentId filename prefix), **#8** (shareAsync iOS-cancel), and **#10** (native language-name extraction). For the current sheet stack see [`flashlist-v2-maintainvisiblecontentposition-default-20260605.md`](./flashlist-v2-maintainvisiblecontentposition-default-20260605.md) (FlashList v2 list behavior) and the native-formSheet refactor plan in Related.

## Context

Replacing full-screen React Native `Modal` components with `@gorhom/bottom-sheet` in an Expo SDK 54 app (React Native 0.81.5, New Architecture enabled) surfaces a cluster of pitfalls across four layers: gesture handler bootstrap, sheet lifecycle semantics, expo-file-system v19 API changes, and UX/correctness regressions. Each pitfall is independently triggerable; hitting all of them in a single migration is common. The prior implementation used standard RN `Modal` with `animationType="slide"` and a combined Language+Subtitle modal with draft-state Apply/Close flow (session history).

## Guidance

### 1. GestureHandlerRootView must fall back to View

`react-native-gesture-handler` requires `GestureHandlerRootView` at the root of the component tree. If the `require()` fails (fresh install, Jest, native module not linked), the variable stays `undefined`. Since `ErrorBoundary` is nested inside it, the crash produces an unrecoverable white screen.

```tsx
const RootWrapper = GestureHandlerRootView ?? View

return (
  <RootWrapper style={{ flex: 1 }}>
    <ErrorBoundary>{/* ... */}</ErrorBoundary>
  </RootWrapper>
)
```

### 2. onChange fires on every snap transition, not only on open

Using `onChange` to remount content via a reset key must guard against intermediate snap transitions. A sheet with `snapPoints={["75%", "100%"]}` fires `onChange` with `index=0` on open AND `index=1` when dragged to full height — both satisfy `index >= 0`.

```tsx
// Wrong — resets state on every snap
onChange={(index) => { if (index >= 0) resetKey++ }}

// Correct — only resets on closed → open transition
const prevIndex = useRef(-1)
onChange={(index) => {
  if (prevIndex.current === -1 && index >= 0) resetKey++
  prevIndex.current = index
}}
```

### 3. enableContentPanningGesture blocks list scrolling at partial snap points

At a 75% snap point, dragging list content expands the sheet instead of scrolling the list. Set `enableContentPanningGesture={false}` so only the handle controls sheet expansion and the content area scrolls freely.

### 4. expo-file-system v19 removed legacy API from default export

v19's new class-based API (`File`, `Directory`, `Paths`) replaced `cacheDirectory` and `downloadAsync`. The only Metro-resolvable path to the legacy surface is the internal `expo-file-system/src/legacy`. This is a private path and may break on future SDK upgrades.

```ts
import { cacheDirectory, downloadAsync } from "expo-file-system/src/legacy"
```

### 5. cacheDirectory is string | null — guard before interpolation

Template literal interpolation silently produces `"nullvideo.mp4"` when `cacheDirectory` is null (possible on Android before filesystem initialization).

```ts
if (!cacheDirectory) throw new Error("Cache directory unavailable")
const localUri = `${cacheDirectory}${filename}`
```

### 6. Prefix download filenames with a unique ID

Different quality tiers can share the same CDN filename. Without a prefix, downloading Low quality overwrites the cached Highest quality file.

```ts
const filename = `${documentId}-${url.split("/").pop()?.split("?")[0] ?? "video.mp4"}`
```

### 7. Terms of Use checkbox must force reading before acceptance

Replacing the modal-open-on-first-tap flow with a direct `setAccepted(v => !v)` toggle bypasses the legal requirement to read terms before accepting. The conditional is not UX polish — it is a legal gate.

```ts
onPress={() => {
  if (accepted) setAccepted(false)
  else openTermsModal()
}}
```

### 8. Sharing.shareAsync throws on iOS cancel

Dismissing the iOS share sheet raises an error. If caught by the outer download error handler, it surfaces "Download failed" to the user. Wrap `shareAsync` in its own try/catch.

```ts
try {
  const { uri } = await downloadAsync(url, localUri)
  try {
    await Sharing.shareAsync(uri, {
      mimeType: "video/mp4",
      UTI: "public.mpeg-4",
    })
  } catch {
    /* iOS share sheet cancel — not an error */
  }
} catch {
  Alert.alert("Download failed", "Could not download the video.")
}
```

### 9. Use BottomSheetFlatList for large lists

> **Superseded (2026-06-05):** these sheets now use `@shopify/flash-list` (FlashList v2) inside a native formSheet, not `BottomSheetFlatList`. FlashList virtualizes by default but needs an explicit height inside the formSheet and `maintainVisibleContentPosition={{ disabled: true }}` for search-filtered lists — see [`flashlist-v2-maintainvisiblecontentposition-default-20260605.md`](./flashlist-v2-maintainvisiblecontentposition-default-20260605.md). The original `BottomSheetFlatList` guidance below applies only if you use `@gorhom/bottom-sheet`.

Videos can have 2,200+ language variants. Rendering via `.map()` creates all views upfront. Use `BottomSheetFlatList` (not plain `FlatList`) for proper gesture coordination inside the sheet.

```tsx
<BottomSheetFlatList
  data={variants}
  keyExtractor={(v) => v.documentId}
  renderItem={renderItem}
  initialNumToRender={15}
  maxToRenderPerBatch={20}
  windowSize={5}
/>
```

### 10. Extract native language names during normalization

Admin stores language names as JSON locale maps. If the normalization layer resolves only to the English name, the native name is lost. Extract `languageNameNative` using the variant's BCP-47 locale code during normalization, not at the display layer.

## Why This Matters

Each pitfall is a silent failure mode. The gesture handler crash produces a white screen with no error boundary. The onChange key regression resets user-selected state mid-interaction. The null coercion writes a corrupted cache path. The Terms regression is a legal compliance gap. The share-cancel false error erodes trust. Individually, most of these pass a first-pass code review; they only surface under specific interaction sequences or data conditions.

## When to Apply

- Migrating any React Native modal to `@gorhom/bottom-sheet` in Expo SDK 54+
- Upgrading `expo-file-system` from v18 to v19
- Adding a download-and-share flow to any React Native component
- Any sheet with multiple snap points where remounting content on snap is undesirable
- Any sheet containing a scrollable list with more than ~100 items
- Any flow where a legal acceptance gate is adjacent to a UI pattern change

## Examples

**Before / After — onChange remount on every snap**

Before: user drags language sheet from 75% to 100% → search query wiped, scroll position lost.

After: sheet expands smoothly, search query preserved, only resets when sheet opens from closed state.

**Before / After — GestureHandlerRootView crash**

Before: `react-native-gesture-handler` fails to load → unrecoverable white screen, ErrorBoundary unreachable.

After: falls back to `View`, app renders with degraded gesture support, ErrorBoundary catches downstream errors normally.

**Before / After — expo-file-system v19**

Before: `import * as FileSystem from 'expo-file-system'` → `FileSystem.cacheDirectory` is `undefined` in v19.

After: `import { cacheDirectory, downloadAsync } from 'expo-file-system/src/legacy'` with null guard.

## Related

- `docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md` — z-index vs touch priority; `@gorhom/bottom-sheet` uses a portal pattern that avoids this
- `docs/solutions/mobile/quiz-button-section-webview-modal-pipeline.md` — native module additions require EAS native build; Jest `transformIgnorePatterns` must be updated in the same commit
- `docs/solutions/best-practices/mobile-video-detail-page-patterns-20260527.md` — mounted-vs-visible animation pattern; `@gorhom/bottom-sheet` keeps sheets mounted at index -1
- `docs/solutions/best-practices/flashlist-v2-maintainvisiblecontentposition-default-20260605.md` — current FlashList v2 list behavior in these sheets (supersedes #9 for the native-formSheet stack)
- `docs/plans/2026-05-27-001-feat-mobile-watch-bottom-sheets-plan.md` — implementation plan for this (now-reverted) `@gorhom` migration
- `docs/plans/2026-05-29-001-refactor-watch-sheets-native-formsheet-plan.md` — the subsequent refactor from `@gorhom/bottom-sheet` to native formSheet
