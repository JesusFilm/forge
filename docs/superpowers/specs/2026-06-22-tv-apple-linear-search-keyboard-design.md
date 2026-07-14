# TV search keyboard — platform-varied layout (Apple TV linear, Android TV grid)

**Date:** 2026-06-22
**App:** `apps/tv`
**Status:** design approved, pending spec review

## Problem

The `/search` on-screen keyboard renders the same 6-column grid on every TV
platform. Apple TV's native search idiom is a single horizontal line of letters
you sweep across with the remote; a grid feels foreign there. Android TV's
native idiom is a grid, which the current layout already matches.

We want the keyboard and screen layout to vary by platform:

- **Apple TV (`Platform.OS === "ios"`):** a single horizontal line of keys at
  the top of the screen, with search results stacked **below** it.
- **Android TV (`Platform.OS === "android"`):** keep the existing grid keyboard
  and two-pane layout (keyboard left, results right) exactly as-is.

The app is TV-only, so `Platform.OS` maps cleanly: `ios` → Apple TV, `android`
→ Android TV.

## Current state (what exists today)

- `src/components/search/keyGrid.ts` — pure model: `KeyAction`, `KeyCell`,
  `buildLetterRows(isShifted)`, `buildActionRow(isShifted)`, and the tested
  reducer `applyKey(value, action)`. No JSX, unit-tested in `keyGrid.test.ts`.
- `src/components/search/SearchKeyboard.tsx` — renders the 6-column grid +
  action row. Local `KeyButton` does the focus-pop animation
  (`useFocusAnimation` + `focusTransform`). Lowercase default, inline `ABC/abc`
  shift toggle.
- `app/search.tsx` — owns `query` state and all search hooks
  (`useSemanticSearch`, `useSearchHistory`). Body is a **two-pane** row:
  `keyboardPane` (left) + `resultsPane` (right, meta line + `SearchResultsGrid`
  or `SearchBrowse`). Results grid uses `RESULTS_COLUMNS = 3`.

## Decision: recreate, don't import a native keyboard

There is **no importable native keyboard** that fits this screen.
`react-native-tvos` (0.81.5-2) exposes TV focus primitives but no search
keyboard. tvOS's native keyboard exists only inside `UISearchController` /
`UISearchContainerViewController` — a system-presented, full-screen search
experience you cannot embed piecemeal. The only RN bridge
(`react-native-screens` `SearchBar` via `headerSearchBarOptions`) is a
header/modal flow gated to `['ios','android']` with no official tvOS support,
and adopting it would surrender layout control, theming, and integration with
the existing `useSemanticSearch` pipeline. The current keyboard is already a
from-scratch RN keyboard; the linear version is a layout variant of code we
already own.

## Keyboard case behavior (decided)

The Apple TV linear keyboard mirrors the grid's case behavior: **lowercase a–z
by default with an inline `ABC/abc` shift toggle**, then `space · delete · ⏎`.
This keeps typed-case behavior consistent across platforms and reuses the
existing reducer with zero changes.

## Design

### 1. Shared model — `keyGrid.ts`

Add one pure helper; change nothing else:

```ts
/**
 * Flat key list for the single-line (Apple TV) keyboard: 26 letters in the
 * active case, then the action keys (shift · space · delete · submit).
 * Reuses buildActionRow so the linear and grid keyboards stay in lockstep.
 */
export function buildLinearKeys(isShifted: boolean): KeyCell[] {
  return [...buildLetterRows(isShifted).flat(), ...buildActionRow(isShifted)]
}
```

`KeyAction`, `KeyCell`, `applyKey`, `buildActionRow`, `buildLetterRows` are
untouched. New unit tests in `keyGrid.test.ts` cover: flat order (26 letters
then `shift, space, backspace, submit`), and case toggle flipping every letter.

Compact dimension tokens for the single line (letters must fit one row within
the ~1760px content width). Reuse the old strip's proportions:

```ts
export const LINEAR_KEY_SIZE = 48 // letter key (vs grid KEY_SIZE 72)
export const LINEAR_KEY_WIDTH_WIDE = 72 // shift/space/delete/submit
export const LINEAR_KEY_GAP = 8
```

### 2. Shared `KeyButton.tsx` (extracted)

Extract the focus-pop key button out of `SearchKeyboard.tsx` into
`src/components/search/KeyButton.tsx`, parameterized by size so both keyboards
share the animation/focus logic without duplication:

```ts
type KeyButtonProps = {
  cell: KeyCell
  hasTVPreferredFocus: boolean
  onPress: () => void
  size: number // square key edge (LINEAR_KEY_SIZE or KEY_SIZE)
  wideWidth: number // width when cell.wide (LINEAR_KEY_WIDTH_WIDE or KEY_WIDTH_WIDE)
}
```

Behavior identical to today: `useFocusAnimation` → `focusTransform({ lift: 0,
magnify: 1.1 })`, white-fill focus (`SEARCH_THEME.keyFocusBg`/`keyFocusText`),
Ionicons `backspace-outline` for the delete key. `SearchKeyboard.tsx` switches
to import it, passing the grid's `KEY_SIZE`/`KEY_WIDTH_WIDE`. This keeps the
Android keyboard behaviorally unchanged (same render output, same focus).

### 3. Linear keyboard — `SearchKeyboardLinear.tsx` (new)

Single horizontal row of `buildLinearKeys(isShifted)` keys, wrapped in a
horizontal `ScrollView` so tvOS auto-scrolls to the focused key (the native
"swipe along the line" feel) if the row ever exceeds the visible width.

- Same `dispatch` logic as `SearchKeyboard`: `shift` toggles local `isShifted`;
  `submit` fires `onSubmit`; value-mutating actions forward `applyKey`'s
  non-null result to `onChange`.
- `hasTVPreferredFocus` on the first letter (position 0), matching the grid.
- Focus traps via `TVFocusGuideView`: `trapFocusLeft` + `trapFocusRight` (single
  row — don't fall off the ends), `trapFocusUp` (nothing focusable above except
  the non-focusable query line). **Down is NOT trapped** so D-pad-down escapes
  into the results grid below.
- Same `Props` shape as `SearchKeyboard` (`value`, `onChange`, `onSubmit`) so
  the screen can swap them by platform with no prop changes.

`ScrollView` config: `horizontal`, `showsHorizontalScrollIndicator={false}`,
`contentContainerStyle` with `LINEAR_KEY_GAP`. (If a single non-scrolling row
fits comfortably at the chosen sizes, the ScrollView is inert — it costs
nothing and guards against overflow on narrower effective widths.)

### 4. Screen layout — `app/search.tsx`

`SearchScreen` keeps owning ALL state and hooks (`query`, `useSemanticSearch`,
`useSearchHistory`, `setSanitizedQuery`, `runQueryImmediate`, `meta`,
`hasQuery`). Extract the body into two small presentational sub-components
declared as local function components **within `app/search.tsx`** (keeps the
prop wiring next to the state that feeds it; the diff stays contained to the
route file plus the two new keyboard/button files). Each receives the
already-wired props, and the route picks one by platform:

```tsx
const isAppleTV = Platform.OS === "ios"
// ...
{
  isAppleTV ? (
    <SearchBodyStacked {...bodyProps} /> // keyboard line on top, results below (full width)
  ) : (
    <SearchBodyTwoPane {...bodyProps} /> // existing grid keyboard left, results right
  )
}
```

- **`SearchBodyTwoPane`** — the existing body, lifted verbatim (keyboardPane +
  resultsPane, `RESULTS_COLUMNS = 3`). Android path stays identical.
- **`SearchBodyStacked`** (Apple TV) — vertical stack:
  `SearchKeyboardLinear` (top) → meta line → `TVFocusGuideView` results region
  filling the rest, full screen width. Full width → **omit `columns`** so
  `SearchResultsGrid` uses its purpose-built responsive full-width default
  (4 columns at 1080p, 6 at 4K-class ≥2880dp) vs the two-pane's fixed 3.
  (Revised from an earlier hardcoded "5": the grid has no path that yields
  exactly 5, and reusing its tuned default is the cleaner choice.) Same
  conditional inside: `SearchResultsGrid` when `hasQuery`, else `SearchBrowse`.

`bodyProps` carries: `query`, `state`, `results`, `meta`, `hasQuery`,
`setSanitizedQuery`, `submit`, `runQueryImmediate`, `clearAll`, `recents`,
`retry`. The `QueryDisplay` query line stays at the top for BOTH layouts
(shared, above the platform branch).

### Component boundaries

| Unit                                      | Responsibility                                 | Depends on                                           |
| ----------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `keyGrid.ts`                              | Pure key model + reducer (+ `buildLinearKeys`) | nothing                                              |
| `KeyButton.tsx`                           | One focusable animated key                     | `keyGrid` types, `useFocusAnimation`, `SEARCH_THEME` |
| `SearchKeyboard.tsx`                      | Grid layout (Android)                          | `keyGrid`, `KeyButton`                               |
| `SearchKeyboardLinear.tsx`                | Single-row layout (Apple TV)                   | `keyGrid`, `KeyButton`                               |
| `SearchBodyTwoPane` / `SearchBodyStacked` | Body layout per platform                       | keyboards, results/browse                            |
| `app/search.tsx`                          | State/hooks + platform pick                    | both bodies                                          |

## Constraints (what NOT to do)

- Do NOT change `applyKey`, `buildLetterRows`, `buildActionRow`, or the grid's
  visible behavior — Android must render and behave exactly as it does now.
- Do NOT import or wire a native tvOS search controller / `react-native-screens`
  SearchBar. Recreate (decision above).
- Do NOT add `react-native-gesture-handler` (breaks Expo Go) — the ScrollView's
  built-in tvOS focus-scroll is sufficient; no custom gestures.
- Do NOT branch on `Platform.isTV` for the split — use `Platform.OS` (`ios` vs
  `android`) since both are TV here and we need to distinguish the two.
- Keep CMS-sourced URL validation and `sanitizeQuery` write-site behavior
  unchanged — only the keyboard/layout shell changes.
- No floating scroll hints / down-chevrons (not a TV pattern).

## Testing & verification

**Unit:** extend `keyGrid.test.ts` with `buildLinearKeys` tests (flat order,
case toggle). `applyKey` is already covered and unchanged.

**Simulator (Apple TV):** EXPO_TV Metro on 8082, deep-link
`exp+jesus-film-forge-tv:///search`, drive the D-pad via `idb`. Confirm:

- single horizontal line of keys at the top, results stacked below;
- typing updates `QueryDisplay`; shift toggles case; `⏎` submits;
- D-pad-down from the keyboard reaches the results grid; D-pad-left/right sweeps
  the keyboard line without falling off the ends.

**Android TV (regression):** confirm the grid keyboard + two-pane layout is
unchanged (screenshot compare against current behavior).

## Out of scope

- Numbers/symbols on the keyboard (neither platform has them today).
- Changing the search pipeline, debounce, history, or results rendering.
- Any change to Home, watch, or series surfaces.
