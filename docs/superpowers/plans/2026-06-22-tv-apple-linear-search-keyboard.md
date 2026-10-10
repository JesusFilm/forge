# TV Apple-TV Linear Search Keyboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Apple TV, render the `/search` on-screen keyboard as a single horizontal line at the top of the screen with results stacked below; keep the existing grid + two-pane layout on Android TV.

**Architecture:** Reuse the existing pure key model (`keyGrid.ts`) and its tested reducer `applyKey`. Add a flat-list builder + size tokens, extract the animated key button into a shared `KeyButton`, add a single-row `SearchKeyboardLinear`, and branch `app/search.tsx` by `Platform.OS` into a stacked (Apple TV) body and the existing two-pane (Android) body. No native search controller — a real-device spike proved `react-native-screens` `headerSearchBarOptions` crashes on tvOS (`RCTNativeAnimatedModule addAnimatedEventToView` at mount).

**Tech Stack:** React Native (react-native-tvos 0.81.5-2), Expo SDK 54 managed, expo-router, TypeScript strict, Jest (jest-expo preset).

## Global Constraints

- **Platform split:** Apple TV = `Platform.OS === "ios"`; Android TV = `Platform.OS === "android"`. The app is TV-only, so this is the correct discriminator (NOT `Platform.isTV`, which is true for both).
- **Android path is behavior-frozen:** the grid keyboard (`SearchKeyboard`) and two-pane layout must render and behave exactly as on `origin/main`. The shared `KeyButton` must reproduce the grid's current pixel values when handed `GRID_KEY_DIMS`.
- **Reuse, don't fork:** do NOT modify `applyKey`, `buildLetterRows`, or `buildActionRow`. `buildLinearKeys` composes them.
- **Case behavior:** lowercase a–z default + inline `ABC/abc` shift toggle, then `space · delete · ⏎` — identical to the grid.
- **No new deps.** Do NOT add `react-native-gesture-handler` (breaks Expo Go). Do NOT adopt the native tvOS search controller.
- **Scaling:** all design dimensions are 1920-canvas units passed through `scale()` (font sizes additionally `Math.round(scale(...))` per the Android sub-pixel rule).
- **All CMS URLs** continue to flow through existing validation; this change touches only the keyboard/layout shell, not the search pipeline.
- **Commands** (run from `apps/tv/`, or repo root with `--filter @forge/tv`):
  - Test one file: `pnpm --filter @forge/tv exec jest src/components/search/keyGrid.test.ts`
  - Typecheck: `pnpm --filter @forge/tv typecheck` (→ `tsc --noEmit`)
  - Lint: `pnpm --filter @forge/tv lint` (→ `eslint .`)

---

## File Structure

| File                                                     | Change | Responsibility                                                                                                |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `apps/tv/src/components/search/keyGrid.ts`               | Modify | Add `buildLinearKeys`, `KeyDims` type, `GRID_KEY_DIMS`, `LINEAR_*` tokens + `LINEAR_KEY_DIMS`. Pure (no JSX). |
| `apps/tv/src/components/search/keyGrid.test.ts`          | Modify | Add `buildLinearKeys` unit tests.                                                                             |
| `apps/tv/src/components/search/KeyButton.tsx`            | Create | One focusable, animated key, sized by a `KeyDims`. Shared by both keyboards.                                  |
| `apps/tv/src/components/search/SearchKeyboard.tsx`       | Modify | Grid layout (Android). Rewire to the shared `KeyButton`; drop the local one.                                  |
| `apps/tv/src/components/search/SearchKeyboardLinear.tsx` | Create | Single-row layout (Apple TV) in a focus-scrolling `ScrollView`.                                               |
| `apps/tv/app/search.tsx`                                 | Modify | Own state/hooks; branch layout by `Platform.OS`; shared `SearchResultsPane` + two body shells.                |

**Reuse map (consumed, do not redefine):**

- `keyGrid.ts`: `KeyAction`, `KeyCell`, `applyKey`, `buildLetterRows`, `buildActionRow`, `KEY_SIZE` (72), `KEY_WIDTH_WIDE` (154), `KEY_RADIUS` (12), `KEY_GAP` (10).
- `../watch/useFocusAnimation`: `useFocusAnimation()` → `{ focused, setFocused, progress }`; `focusTransform(progress, { lift, magnify })`.
- `../TVFocusGuideView`: `TVFocusGuideView` with `trapFocusLeft|Right|Up|Down` boolean props.
- `./searchTheme`: `SEARCH_THEME` (`keyBg`, `keyText`, `keyFocusBg`, `keyFocusText`).
- `../../lib/scale`: `scale(size: number): number`.
- `./SearchResultsGrid`: `<SearchResultsGrid state results query columns? onRetry? />` (omitting `columns` → responsive full-width default: 4 cols at ≤2880dp, 6 above).
- `./SearchBrowse`: `<SearchBrowse recents onRunQuery onClearHistory />`.
- Types for body props: `SearchState` from `../src/lib/search`, `SearchResult` from `../src/lib/queries`.

---

### Task 1: Pure key model — `buildLinearKeys` + size tokens

**Files:**

- Modify: `apps/tv/src/components/search/keyGrid.ts`
- Test: `apps/tv/src/components/search/keyGrid.test.ts`

**Interfaces:**

- Consumes: existing `buildLetterRows`, `buildActionRow`, `KeyCell`, `KEY_SIZE`, `KEY_WIDTH_WIDE`, `KEY_RADIUS`.
- Produces:
  - `buildLinearKeys(isShifted: boolean): KeyCell[]` — 26 letters (active case) then `shift, space, backspace, submit` (length 30).
  - `type KeyDims = { size: number; wideWidth: number; radius: number; labelFontSize: number; iconSize: number }` (raw 1920-canvas units).
  - `GRID_KEY_DIMS: KeyDims` = `{ size: 72, wideWidth: 154, radius: 12, labelFontSize: 26, iconSize: 28 }` (reproduces the grid's current values).
  - `LINEAR_KEY_SIZE = 48`, `LINEAR_KEY_WIDTH_WIDE = 72`, `LINEAR_KEY_GAP = 8`.
  - `LINEAR_KEY_DIMS: KeyDims` = `{ size: 48, wideWidth: 72, radius: 10, labelFontSize: 20, iconSize: 24 }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/tv/src/components/search/keyGrid.test.ts`. Add `buildLinearKeys` to the existing import from `./keyGrid` (line 1–6), then add this describe block at the end of the file:

```ts
describe("buildLinearKeys", () => {
  it("is 26 letters followed by the action row (shift · space · delete · search)", () => {
    const keys = buildLinearKeys(false)
    expect(keys).toHaveLength(30)
    expect(
      keys
        .slice(0, 26)
        .map((k) => k.label)
        .join(""),
    ).toBe("abcdefghijklmnopqrstuvwxyz")
    expect(keys.slice(26).map((k) => k.action.kind)).toEqual([
      "shift",
      "space",
      "backspace",
      "submit",
    ])
  })

  it("flips every letter to uppercase when shifted, action row unchanged in kind", () => {
    const upper = buildLinearKeys(true)
    expect(
      upper
        .slice(0, 26)
        .map((k) => k.label)
        .join(""),
    ).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    expect(upper.slice(26).map((k) => k.action.kind)).toEqual([
      "shift",
      "space",
      "backspace",
      "submit",
    ])
  })

  it("has unique ids across the whole row", () => {
    const ids = buildLinearKeys(false).map((k) => k.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("reuses position-based letter ids (stable across case toggle)", () => {
    expect(buildLinearKeys(false).map((k) => k.id)).toEqual(
      buildLinearKeys(true).map((k) => k.id),
    )
    expect(buildLinearKeys(false)[0].id).toBe("letter-0")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge/tv exec jest src/components/search/keyGrid.test.ts`
Expected: FAIL — `buildLinearKeys is not a function` (or a TS/import error on the name).

- [ ] **Step 3: Implement the builder + tokens**

In `apps/tv/src/components/search/keyGrid.ts`, immediately AFTER the existing dimension constants block (the `KEY_RADIUS = 12` line, ~line 43), add:

```ts
/**
 * Per-keyboard size tokens (raw 1920-canvas units; consumers pass through
 * scale()). The grid and the single-line (Apple TV) keyboard differ only in
 * these numbers — the focus/animation logic is shared in KeyButton.
 */
export type KeyDims = {
  size: number
  wideWidth: number
  radius: number
  labelFontSize: number
  iconSize: number
}

/** Grid keyboard (Android) — reproduces SearchKeyboard's current pixel values. */
export const GRID_KEY_DIMS: KeyDims = {
  size: KEY_SIZE,
  wideWidth: KEY_WIDTH_WIDE,
  radius: KEY_RADIUS,
  labelFontSize: 26,
  iconSize: 28,
}

/** Single-line keyboard (Apple TV) — compact so ~30 keys fit one row. */
export const LINEAR_KEY_SIZE = 48
export const LINEAR_KEY_WIDTH_WIDE = 72
export const LINEAR_KEY_GAP = 8
export const LINEAR_KEY_DIMS: KeyDims = {
  size: LINEAR_KEY_SIZE,
  wideWidth: LINEAR_KEY_WIDTH_WIDE,
  radius: 10,
  labelFontSize: 20,
  iconSize: 24,
}
```

Then, after `buildActionRow` (end of file, before `applyKey` or at file end), add:

```ts
/**
 * Flat key list for the single-line (Apple TV) keyboard: the 26 letters in the
 * active case, then the action keys (shift · space · delete · submit). Reuses
 * buildLetterRows + buildActionRow so the linear and grid keyboards stay in
 * lockstep — same cells, same ids, same reducer (applyKey).
 */
export function buildLinearKeys(isShifted: boolean): KeyCell[] {
  return [...buildLetterRows(isShifted).flat(), ...buildActionRow(isShifted)]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @forge/tv exec jest src/components/search/keyGrid.test.ts`
Expected: PASS (all `buildLinearKeys` tests green, existing tests still green).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @forge/tv typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/tv/src/components/search/keyGrid.ts apps/tv/src/components/search/keyGrid.test.ts
git commit -m "feat(tv): add buildLinearKeys + key size tokens for single-line keyboard"
```

---

### Task 2: Extract the shared `KeyButton`

**Files:**

- Create: `apps/tv/src/components/search/KeyButton.tsx`
- Modify: `apps/tv/src/components/search/SearchKeyboard.tsx`

**Interfaces:**

- Consumes: `KeyCell`, `KeyDims`, `GRID_KEY_DIMS` from `./keyGrid`; `useFocusAnimation`, `focusTransform`; `SEARCH_THEME`; `scale`.
- Produces: `<KeyButton cell={KeyCell} hasTVPreferredFocus={boolean} onPress={() => void} dims={KeyDims} />`.

This is a refactor: the grid's render output must be unchanged. `GRID_KEY_DIMS` reproduces the exact values (`size 72`, `wideWidth 154`, `radius 12`, label `Math.round(scale(26))`, icon `scale(28)`, same focus shadow).

- [ ] **Step 1: Create `KeyButton.tsx`**

```tsx
import Ionicons from "@expo/vector-icons/Ionicons"
import { useMemo } from "react"
import { Animated, Pressable, StyleSheet, Text } from "react-native"

import { scale } from "../../lib/scale"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"
import type { KeyCell, KeyDims } from "./keyGrid"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  cell: KeyCell
  hasTVPreferredFocus: boolean
  onPress: () => void
  /** Per-keyboard size tokens (GRID_KEY_DIMS or LINEAR_KEY_DIMS). */
  dims: KeyDims
}

/**
 * One focusable, animated keyboard key, shared by the grid (Android) and
 * single-line (Apple TV) keyboards. Sizing comes entirely from `dims` so the
 * two keyboards differ only in numbers, not behavior:
 *
 *   - focus pop via useFocusAnimation → focusTransform (lift 0, magnify 1.1);
 *     the timing stops the prior animation before the next so a rapid D-pad
 *     sweep can't orphan animations;
 *   - white-fill focus (SEARCH_THEME.keyFocusBg) + near-black ink;
 *   - the backspace key renders an Ionicons glyph instead of a text label.
 */
export function KeyButton({ cell, hasTVPreferredFocus, onPress, dims }: Props) {
  const { focused, setFocused, progress } = useFocusAnimation()

  const keyTransform = useMemo(
    () => focusTransform(progress, { lift: 0, magnify: 1.1 }),
    [progress],
  )

  const inkColor = focused ? SEARCH_THEME.keyFocusText : SEARCH_THEME.keyText

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={cell.accessibilityLabel ?? cell.label}
    >
      <Animated.View
        style={[
          styles.key,
          {
            width: scale(cell.wide === true ? dims.wideWidth : dims.size),
            height: scale(dims.size),
            borderRadius: scale(dims.radius),
          },
          focused && styles.keyFocused,
          { transform: keyTransform },
        ]}
      >
        {cell.action.kind === "backspace" ? (
          <Ionicons
            name="backspace-outline"
            size={scale(dims.iconSize)}
            color={inkColor}
          />
        ) : (
          <Text
            style={[
              styles.keyLabel,
              {
                color: inkColor,
                fontSize: Math.round(scale(dims.labelFontSize)),
              },
            ]}
          >
            {cell.label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  key: {
    backgroundColor: SEARCH_THEME.keyBg,
    alignItems: "center",
    justifyContent: "center",
  },
  keyFocused: {
    backgroundColor: SEARCH_THEME.keyFocusBg,
    // Design: 0 12px 28px -10px rgba(0,0,0,.7).
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: scale(12) },
    shadowRadius: scale(14),
    shadowOpacity: 0.7,
    elevation: 8,
  },
  keyLabel: {
    fontFamily: "System",
    fontWeight: "600",
  },
})
```

- [ ] **Step 2: Rewire `SearchKeyboard.tsx` to the shared `KeyButton`**

In `apps/tv/src/components/search/SearchKeyboard.tsx`:

(a) Replace the imports block (lines 1–19) with — note the removed `Ionicons`, `Animated`/`Pressable`/`Text` (no longer rendered here), `focusTransform`/`useFocusAnimation`, and the now-unused dimension constants; add `KeyButton` + `GRID_KEY_DIMS`:

```tsx
import { useMemo, useState } from "react"
import { StyleSheet, View } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { KeyButton } from "./KeyButton"
import {
  applyKey,
  buildActionRow,
  buildLetterRows,
  GRID_KEY_DIMS,
  type KeyAction,
  KEY_GAP,
} from "./keyGrid"
```

(b) Delete the entire local `KeyButton` function (the `function KeyButton({ ... }) { ... }` block, currently lines ~104–158).

(c) In the two `<KeyButton ... />` call sites, add the `dims` prop:

```tsx
<KeyButton
  key={cell.id}
  cell={cell}
  hasTVPreferredFocus={rowIdx === 0 && colIdx === 0}
  onPress={() => dispatch(cell.action)}
  dims={GRID_KEY_DIMS}
/>
```

and the action-row call site:

```tsx
<KeyButton
  key={cell.id}
  cell={cell}
  hasTVPreferredFocus={false}
  onPress={() => dispatch(cell.action)}
  dims={GRID_KEY_DIMS}
/>
```

(d) In the `StyleSheet.create({ ... })` at the bottom, DELETE the `key`, `keyWide`, `keyFocused`, and `keyLabel` style entries (now owned by `KeyButton`). KEEP `keyboard` and `row`. The remaining styles object:

```tsx
const styles = StyleSheet.create({
  keyboard: {
    flexDirection: "column",
    gap: scale(KEY_GAP),
    alignItems: "flex-start",
  },
  row: {
    flexDirection: "row",
    gap: scale(KEY_GAP),
  },
})
```

- [ ] **Step 3: Typecheck (catches any leftover unused import / missing symbol)**

Run: `pnpm --filter @forge/tv typecheck`
Expected: no errors. (If it flags `KEY_SIZE`/`KEY_WIDTH_WIDE`/`KEY_RADIUS` as unused imports, remove them from the import list — they were only used by the deleted styles.)

- [ ] **Step 4: Lint**

Run: `pnpm --filter @forge/tv lint`
Expected: no errors (no unused vars).

- [ ] **Step 5: Run the keyboard model tests (sanity, nothing should have moved)**

Run: `pnpm --filter @forge/tv exec jest src/components/search/keyGrid.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/tv/src/components/search/KeyButton.tsx apps/tv/src/components/search/SearchKeyboard.tsx
git commit -m "refactor(tv): extract shared KeyButton (size-parameterized) from SearchKeyboard"
```

---

### Task 3: `SearchKeyboardLinear` (Apple TV single-row keyboard)

**Files:**

- Create: `apps/tv/src/components/search/SearchKeyboardLinear.tsx`

**Interfaces:**

- Consumes: `applyKey`, `buildLinearKeys`, `LINEAR_KEY_DIMS`, `LINEAR_KEY_GAP`, `KeyAction` from `./keyGrid`; `KeyButton`; `TVFocusGuideView`; `scale`.
- Produces: `<SearchKeyboardLinear value={string} onChange={(next: string) => void} onSubmit={() => void} />` — same prop shape as `SearchKeyboard`, so the screen swaps them by platform without prop changes.

- [ ] **Step 1: Create `SearchKeyboardLinear.tsx`**

```tsx
import { useMemo, useState } from "react"
import { ScrollView, StyleSheet } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { KeyButton } from "./KeyButton"
import {
  applyKey,
  buildLinearKeys,
  type KeyAction,
  LINEAR_KEY_DIMS,
  LINEAR_KEY_GAP,
} from "./keyGrid"

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
}

/**
 * Single-line search keyboard for Apple TV — the 26 letters then
 * shift · space · delete · ⏎, laid out in one horizontal row inside a
 * ScrollView so tvOS auto-scrolls to the focused key (the native
 * "swipe along the line" feel) if the row exceeds the visible width.
 *
 * Shares the key model + reducer with the grid keyboard (keyGrid): shift
 * toggles the keyboard's case (component state, no value change), submit fires
 * onSubmit (bypassing the search debounce), and every value-mutating action
 * forwards applyKey's non-null result to onChange. The parent sanitizes at the
 * onChange write site.
 *
 * Focus: trapped left/right (single row — don't fall off the ends). Down is
 * intentionally NOT trapped so D-pad-down drops focus into the results grid
 * stacked below. Up needs no trap — QueryDisplay above is non-focusable
 * (View/Text/Animated.View only, verified), so D-pad-up is already a no-op.
 */
export function SearchKeyboardLinear({ value, onChange, onSubmit }: Props) {
  // Lowercase default; persistent caps-lock-style toggle. Only future presses
  // are affected — already-typed characters in `value` stay as they were.
  const [isShifted, setIsShifted] = useState(false)
  const keys = useMemo(() => buildLinearKeys(isShifted), [isShifted])

  const dispatch = (action: KeyAction) => {
    if (action.kind === "shift") {
      setIsShifted((prev) => !prev)
      return
    }
    if (action.kind === "submit") {
      onSubmit()
      return
    }
    const next = applyKey(value, action)
    if (next != null) onChange(next)
  }

  return (
    <TVFocusGuideView trapFocusLeft trapFocusRight trapFocusDown={false}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {keys.map((cell, index) => (
          <KeyButton
            key={cell.id}
            cell={cell}
            // One-shot focus claim on entry: the first letter ("a"/"A").
            // Position-based so the case toggle doesn't move it.
            hasTVPreferredFocus={index === 0}
            onPress={() => dispatch(cell.action)}
            dims={LINEAR_KEY_DIMS}
          />
        ))}
      </ScrollView>
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: scale(LINEAR_KEY_GAP),
    alignItems: "center",
  },
})
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @forge/tv typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm --filter @forge/tv lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/tv/src/components/search/SearchKeyboardLinear.tsx
git commit -m "feat(tv): add SearchKeyboardLinear single-row keyboard for Apple TV"
```

---

### Task 4: `app/search.tsx` — platform-branched layout

**Files:**

- Modify: `apps/tv/app/search.tsx`

**Interfaces:**

- Consumes: `SearchKeyboard`, `SearchKeyboardLinear`, `SearchResultsGrid`, `SearchBrowse`, `QueryDisplay`, `resolveSearchMeta`, `useSemanticSearch`, `useSearchHistory`, `sanitizeQuery`; `SearchState` from `../src/lib/search`, `SearchResult` from `../src/lib/queries`; `Platform`.
- Produces: the `/search` route. No exports consumed elsewhere.

This task replaces the body markup. `SearchScreen` keeps owning ALL state/hooks (unchanged: lines ~34–86). It adds one shared results sub-component and two body shells, then picks a body by platform. The `QueryDisplay` query line stays at the top for both.

- [ ] **Step 1: Update imports**

Replace the import block at the top of `apps/tv/app/search.tsx` (lines 1–13) with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react"
import { Platform, StyleSheet, Text, View } from "react-native"

import { QueryDisplay } from "../src/components/search/QueryDisplay"
import { SearchBrowse } from "../src/components/search/SearchBrowse"
import { resolveSearchMeta } from "../src/components/search/searchDisplay"
import { SearchKeyboard } from "../src/components/search/SearchKeyboard"
import { SearchKeyboardLinear } from "../src/components/search/SearchKeyboardLinear"
import { SearchResultsGrid } from "../src/components/search/SearchResultsGrid"
import { SEARCH_THEME } from "../src/components/search/searchTheme"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import { scale } from "../src/lib/scale"
import type { SearchResult } from "../src/lib/queries"
import type { SearchState } from "../src/lib/search"
import { sanitizeQuery, useSemanticSearch } from "../src/lib/search"
import { useSearchHistory } from "../src/lib/searchHistory"
```

- [ ] **Step 2: Update the file-level doc comment**

Replace the JSDoc block above `export default function SearchScreen()` (lines ~15–33) with:

```tsx
/**
 * /search route — TV search surface, redesigned to the "Forge TV Home"
 * search-layer mockup. The layout varies by TV platform:
 *
 *   - Apple TV (Platform.OS === "ios"): a single-line keyboard at the top
 *     (SearchKeyboardLinear) with results stacked full-width below it — the
 *     native tvOS "swipe along the line" search idiom.
 *   - Android TV (Platform.OS === "android"): the grid keyboard on the left
 *     (SearchKeyboard) with results in a narrower pane on the right.
 *
 * Both share the query line (big type + blinking caret) at the top and the
 * results region (SearchResultsGrid when the query is non-empty, SearchBrowse —
 * Recent + Categories — when it's empty).
 *
 * SearchScreen owns `query` state and routes all writes through sanitizeQuery so
 * the backend never sees control chars, RTL overrides, or anything beyond 256
 * chars. useSemanticSearch handles debounce, stale-guard, and the state machine.
 *
 * The native tvOS UISearchController is intentionally NOT used: a real-device
 * spike (2026-06-22) proved react-native-screens headerSearchBarOptions crashes
 * on tvOS at mount. See docs/superpowers/specs/2026-06-22-tv-apple-linear-search-keyboard-design.md.
 */
```

- [ ] **Step 3: Replace the `return (...)` body with the platform branch**

Replace the JSX returned by `SearchScreen` (the `return ( <View style={styles.screen}> ... </View> )` block, lines ~88–139) with the following. **Also delete `const showResultsGrid = hasQuery` (line 85)** — it sat outside the replaced block and its only consumer was the old body; the new `SearchResultsPane` keys off `hasQuery` directly, so leaving it would be dead code (an eslint `no-unused-vars` warning). Keep `hasQuery` (line 84) — it is now threaded through `bodyProps`.

```tsx
  const bodyProps: SearchBodyProps = {
    query,
    state,
    results,
    meta,
    hasQuery,
    onChangeQuery: setSanitizedQuery,
    onSubmit: submit,
    onRunQuery: runQueryImmediate,
    onClearHistory: clearAll,
    recents,
    onRetry: retry,
  }

  return (
    <View style={styles.screen}>
      <View style={styles.queryLine}>
        <QueryDisplay value={query} />
      </View>
      {Platform.OS === "ios" ? (
        <SearchBodyStacked {...bodyProps} />
      ) : (
        <SearchBodyTwoPane {...bodyProps} />
      )}
    </View>
  )
}

type SearchBodyProps = {
  query: string
  state: SearchState
  results: SearchResult[]
  meta: string
  hasQuery: boolean
  onChangeQuery: (next: string) => void
  onSubmit: () => void
  onRunQuery: (next: string) => void
  onClearHistory: () => void
  recents: string[]
  onRetry: () => void
}

/**
 * Meta line + results region, shared by both bodies. Renders the results grid
 * when there is a query, else the idle browse grid. `columns` is forwarded to
 * SearchResultsGrid (the two-pane layout passes a fixed count for its narrower
 * pane; the stacked layout omits it to use the responsive full-width default).
 */
function SearchResultsPane({
  state,
  results,
  query,
  meta,
  hasQuery,
  recents,
  onRunQuery,
  onClearHistory,
  onRetry,
  columns,
}: SearchBodyProps & { columns?: number }) {
  return (
    <>
      <View style={styles.metaLine}>
        <Text style={styles.metaText}>{meta}</Text>
      </View>
      <TVFocusGuideView style={styles.resultsRegion}>
        {hasQuery ? (
          <SearchResultsGrid
            state={state}
            results={results}
            query={query}
            columns={columns}
            onRetry={onRetry}
          />
        ) : (
          <SearchBrowse
            recents={recents}
            onRunQuery={onRunQuery}
            onClearHistory={onClearHistory}
          />
        )}
      </TVFocusGuideView>
    </>
  )
}

/**
 * Android TV body: grid keyboard on the left, results pane on the right.
 * D-pad-left from the grid's leftmost column reaches the keyboard by geometry.
 */
function SearchBodyTwoPane(props: SearchBodyProps) {
  return (
    <View style={styles.twoPaneBody}>
      {/* SearchKeyboard intentionally is not remounted on state changes:
          unmounting it kills focus on the currently-pressed letter and the
          tvOS focus engine then hops through a fallback. Keep it mounted. */}
      <View style={styles.keyboardPane}>
        <SearchKeyboard
          value={props.query}
          onChange={props.onChangeQuery}
          onSubmit={props.onSubmit}
        />
      </View>
      <View style={styles.resultsPane}>
        <SearchResultsPane {...props} columns={TWO_PANE_RESULTS_COLUMNS} />
      </View>
    </View>
  )
}

/**
 * Apple TV body: single-line keyboard on top, results stacked full-width below.
 * `columns` is omitted so SearchResultsGrid uses its responsive full-width
 * default (4 columns at ≤2880dp, 6 above). Down from the keyboard drops into
 * the results region (the keyboard does not trap focus downward).
 */
function SearchBodyStacked(props: SearchBodyProps) {
  return (
    <View style={styles.stackedBody}>
      <SearchKeyboardLinear
        value={props.query}
        onChange={props.onChangeQuery}
        onSubmit={props.onSubmit}
      />
      <SearchResultsPane {...props} />
    </View>
  )
}
```

- [ ] **Step 4: Update the styles + columns constant**

In the `StyleSheet.create({ ... })` at the bottom of `search.tsx`, rename the existing `body` style to `twoPaneBody`, add `stackedBody`, and keep the rest. Also rename the `RESULTS_COLUMNS = 3` constant to `TWO_PANE_RESULTS_COLUMNS = 3` (and remove the old `// The results pane is narrower...` comment's reference if it names the old constant). The relevant edits:

```tsx
// Android two-pane: the keyboard takes the left third, so 3 columns keeps
// result cards a comfortable 10-foot size in the narrower right pane.
const TWO_PANE_RESULTS_COLUMNS = 3
```

```tsx
  // Android: keyboard (left) + results (right) fill the height side by side.
  twoPaneBody: {
    flex: 1,
    flexDirection: "row",
    gap: scale(56),
    paddingTop: scale(14),
  },
  // Apple TV: single-line keyboard on top, results filling the space below.
  stackedBody: {
    flex: 1,
    paddingTop: scale(14),
    gap: scale(14),
  },
```

Keep `screen`, `queryLine`, `keyboardPane`, `resultsPane`, `metaLine`, `metaText`, `resultsRegion` exactly as they are.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @forge/tv typecheck`
Expected: no errors. (Confirms `SearchBodyProps` matches all call sites and the `state`/`results` types line up.)

- [ ] **Step 6: Lint**

Run: `pnpm --filter @forge/tv lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/tv/app/search.tsx
git commit -m "feat(tv): branch /search layout by platform — stacked linear (Apple TV), grid two-pane (Android)"
```

---

### Task 5: Simulator verification (Apple TV linear + Android grid regression)

No code; this is the acceptance gate. The `.env.local` is already copied into the worktree and an `EXPO_TV` Metro is running on **8083** (restart with `cd apps/tv && EXPO_TV=1 npx expo start --dev-client --port 8083 --clear` if needed).

- [ ] **Step 1: Load the worktree bundle on the booted Apple TV sim**

```bash
UDID=D346927F-EE6A-49E4-9E98-BAD35E42D58D   # Apple TV 4K (at 1080p), tvOS 26.4 — re-list with: xcrun simctl list devices | grep Booted
open -a Simulator
xcrun simctl openurl $UDID "exp+jesus-film-forge-tv://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8083"
```

- [ ] **Step 2: Deep-link to /search and screenshot**

```bash
xcrun simctl openurl $UDID "exp+jesus-film-forge-tv:///search"
xcrun simctl io $UDID screenshot /tmp/tv-spike/verify-appletv-search.png
```

Confirm visually:

- single horizontal line of keys at the TOP (lowercase a–z then `ABC · ␣ · ⌫ · ⏎`), first key (`a`) focused;
- results/browse region stacked BELOW the keyboard, full width (4 columns once a query returns);
- typing a few letters (drive D-pad with `idb`, see the memory note "Driving tvOS sim D-pad") updates the query line; the `ABC` key flips case; `⏎` submits;
- D-pad-down from the keyboard lands focus in the results/browse area; D-pad-left/right sweeps the full row without focus falling off either end. The row is sized to fit one screen at 1080p (≈1696px of keys within ~1760px of content — see Notes), so all keys should be visible without scrolling. **If** the row overflows on the target device, confirm the `ScrollView` scrolls to keep the focused key visible; if it does NOT auto-scroll to focus, switch `SearchKeyboardLinear` to `FlatList horizontal` (the proven `ContentRail` focus-scroll pattern) — same children, same dispatch.

- [ ] **Step 3: Android TV regression (grid + two-pane unchanged)**

Launch the Android TV dev build (see the `build-android` skill / memory `android_emulator_ram_oom_rn_devbuild` — boot the emulator with `-memory 4096`), point it at this worktree's Metro, deep-link to `/search`, and confirm the grid keyboard on the left + results pane on the right render and behave exactly as before (3-column results pane, white-fill key focus, shift toggle). Capture a screenshot for the PR.

- [ ] **Step 4: Record results in the PR description**

Attach both screenshots (Apple TV stacked + Android grid) as the visual proof for the change.

---

## Notes for the implementer

- **Why no jest component tests:** the search components (`SearchKeyboard`, `SearchBrowse`, etc.) have NO component-level tests in this repo — only the pure modules (`keyGrid`, `searchDisplay`) are unit-tested. Following that convention, automated coverage lives at the `buildLinearKeys` level (Task 1); component correctness is verified by typecheck + lint + the simulator gate (Task 5). Do not introduce a new react-test-renderer harness for this change.
- **Byte-identical Android claim (Task 2):** the only behavioral risk is the `KeyButton` extraction. `GRID_KEY_DIMS` is defined from the existing constants (`KEY_SIZE`/`KEY_WIDTH_WIDE`/`KEY_RADIUS`) plus the literal `26`/`28` the grid already used, and the focus shadow/label styles are copied verbatim — so the rendered grid is unchanged. Step 3 of Task 5 is the empirical confirmation.
- **Single-row width (Task 3) — fits without scrolling:** at `LINEAR_KEY_DIMS`, the row is 26 letters × 48 + action keys (shift 48 + space 72 + delete 48 + ⏎ 48 = 216) + 29 gaps × 8 = **≈1696px**, inside the screen's ~1760px content width (1920 − 2×scale(80)) at 1080p. Only `space` is wide (per `buildActionRow`), so the row fits on one screen and every key is reachable by moving focus — the `ScrollView` is an **inert overflow guard**, not the primary mechanism. The "swipe along the line" feel is focus moving across a fully-visible row. Treat focus-driven auto-scroll as a fallback only, and validate it at the Task 5 gate (with the `FlatList horizontal` fallback noted there).
- **Stacked results column count — deliberate deviation from the spec's "5":** the spec proposed `STACKED_RESULTS_COLUMNS = 5`, but `SearchResultsGrid` has no path that yields exactly 5 (its full-width default is `width >= 2880dp ? 6 : 4`, and Apple TV reports ~1920dp logical at both 1080p and 4K → 4). Rather than override the grid's purpose-built responsive default with a hardcoded 5, `SearchBodyStacked` **omits `columns`** and inherits 4 (1080p) / 6 (4K-class). The spec doc has been updated to match. If product wants exactly 5, pass `columns={5}` in `SearchBodyStacked` instead.
- **Worktree fast-refresh:** after each component task, the running Metro hot-reloads; a hard reload (`openurl` the launcher again) clears any red-box state.
