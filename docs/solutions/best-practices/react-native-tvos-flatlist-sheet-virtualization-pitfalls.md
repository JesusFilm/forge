---
title: "react-native-tvos FlatList in a menu panel: virtualization pitfalls"
date: "2026-06-11"
category: best-practices
module: apps/tv
problem_type: best_practice
component: frontend_stimulus
severity: high
applies_when:
  - "Virtualizing a long list (FlatList) inside a bounded panel, sheet, or overlay menu in react-native-tvos"
  - "A list of 2,000+ rows freezes on open because every row mounts Animated values"
  - "Using hasTVPreferredFocus to land initial focus on the active row of a virtualized list"
  - "The panel is an RN Modal toggled via the visible prop (subtree stays mounted across opens)"
  - "Computing getItemLayout offsets for fixed-height rows, optionally below an in-list header"
symptoms:
  - "Sheet freezes for seconds on open (~22k Animated objects allocated for 2,259 rows)"
  - "Rows and the Close footer paint outside the panel's rounded bounds, or the footer is clipped away entirely"
  - "Focus teleports back to the active row while D-pad browsing the list"
  - "Reopening the sheet shows the previous scroll position instead of the active row"
  - "Hardware Back over the in-player menu exits playback instead of closing the menu"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - "apps/tv/src/components/watch/useVariantList.tsx"
  - "apps/tv/src/components/watch/watchMenuLayout.ts"
  - "apps/tv/src/components/watch/watchMenuStyles.ts"
  - "apps/tv/src/components/watch/WatchOptionRow.tsx"
  - "apps/tv/src/components/watch/LanguagePanel.tsx"
  - "apps/tv/src/components/watch/InPlayerMenu.tsx"
tags:
  - react-native-tvos
  - flatlist
  - virtualization
  - tvos-focus
  - hastvpreferredfocus
  - initialscrollindex
  - yoga-maxheight
  - modal
---

# react-native-tvos FlatList in a menu panel: virtualization pitfalls

## Context

The TV watch page's Audio Language sheet and in-player menu list the full Dub
catalog. A title like the JESUS film carries ~2,259 Dubs, and the original
implementation mounted every row in a plain `ScrollView`. Each `WatchOptionRow`
allocates Animated values (focus progress, background/ink interpolations, icon
cross-fade), so opening the sheet synchronously allocated roughly 22,000
Animated objects and froze the UI. (The all-rows `ScrollView` shape was never a
considered decision for the dub list — the original panels were built when the
focus was a five-pill action row, and the catalog-scale cost surfaced later
(session history).)

Converting to a virtualized `FlatList` fixed the mount cost but surfaced four
interlocking pitfalls — none caught by TypeScript, ESLint, or jest; all only
visible on a TV simulator with a large catalog. Branch
`feat/tv-watch-sheets-design` (PR #1188) documents the failure→fix arc across
commits `c708a3a5` (virtualization), `4b1072fe` (panel bounds), and `91906957`
(one-shot focus, scroll-on-reopen, Back-closes-menu).

## Guidance

### 1. Bound the list with its OWN maxHeight — Yoga won't shrink it against the parent's

**Observed:** after the FlatList conversion, rows painted past the panel's
rounded edge and the Close footer rendered outside the dialog, even though the
panel had `maxHeight`.

**Mechanism:** Yoga does not shrink a flex child against a parent's
`maxHeight` — the parent's max bounds the parent, not the children. The old
`ScrollView` constrained itself implicitly; a bare `FlatList` in a flex column
takes its full content height.

**What didn't work:** `flexShrink: 1` on the list + `overflow: "hidden"` on
the panel. Yoga still didn't shrink the list, and the clip then hid the Close
footer entirely — the viewer had no dismiss affordance (user-reported
regression).

**Fix:** cap the list node's own `maxHeight` (a node always honors its own max
constraint), expressed in whole rows; keep the panel's `overflow: "hidden"`
only as a rounding/clip safety net.

```ts
// watchMenuStyles.ts
list: {
  flexGrow: 0,
  maxHeight: MENU_LIST_VISIBLE_ROWS * WATCH_OPTION_ROW_HEIGHT, // 9 rows
},
panel: {
  maxHeight: scale(820),
  overflow: "hidden", // safety clip — NOT the height constraint
},
```

This is the same root-cause family as the mobile FlashList-in-formSheet rule
("the list needs an explicit height; flex renders all rows") — the list node
must own its height constraint.

### 2. Deterministic fixed-height rows make getItemLayout exact

`initialScrollIndex` on a virtualized list requires `getItemLayout`, and
`getItemLayout` offsets are only trustworthy when row heights are exact — an
error compounds over thousands of rows. Text nodes default their line height
from the font (platform-dependent), so a padding-based row is not
deterministic.

**Fix:** pin `lineHeight` on every text child, give the row a fixed `height`,
and keep the constants in a React-free module (jest-expo can't load
React-importing files) with a unit test pinning the arithmetic:

```ts
// watchMenuLayout.ts (React-free, unit-tested)
export const ROW_VERTICAL_PADDING = scale(16)
export const ROW_LINE_HEIGHT = Math.round(scale(32))
export const WATCH_OPTION_ROW_HEIGHT =
  ROW_VERTICAL_PADDING * 2 + ROW_LINE_HEIGHT
```

```ts
// useVariantList.tsx — headerHeight shifts offsets when a heading renders
// INSIDE the list as ListHeaderComponent
;({
  length: WATCH_OPTION_ROW_HEIGHT,
  offset: headerHeight + index * WATCH_OPTION_ROW_HEIGHT,
  index,
})
```

`numberOfLines={1}` alone is not enough — it truncates text but does not fix
the rendered height. The tokens module also keeps the dependency direction
clean: both the style module and the row component import tokens, instead of
the style module importing from a component (cycle risk).

### 3. One-shot hasTVPreferredFocus — virtualized remounts re-fire focus claims

**Observed:** while D-pad browsing the list, focus teleported back to the
active dub row.

**Mechanism:** react-native-tvos fires `requestFocusSelf` whenever a view with
`hasTVPreferredFocus={true}` is (re)created. On a virtualized list the active
row unmounts when scrolled out of the window and remounts when scrolled back —
and every remount is a fresh focus claim.

**Fix:** arm the prop once per open, disarm on the first focus event from any
row:

```tsx
// useVariantList.tsx
const [focusArmed, setFocusArmed] = useState(true)
const disarmFocus = useCallback(
  () => setFocusArmed((armed) => (armed ? false : armed)),
  [],
)

// renderRow
hasTVPreferredFocus={row.active && focusArmed}
onFocus={disarmFocus}
```

Never leave `hasTVPreferredFocus={row.active}` permanently true on virtualized
rows.

### 4. Scroll-on-reopen — initialScrollIndex is consumed once per FlatList MOUNT

**Observed:** reopening the Language sheet showed the previous scroll position
instead of the active row. The first open was correct; reopens were stale.

**Mechanism:** RN `Modal` keeps its subtree mounted when `visible` flips to
false, so the FlatList never remounts across opens — and `initialScrollIndex`
is read exactly once at mount.

**Fix:** an effect keyed on `visible` re-arms the one-shot focus and
imperatively scrolls (synchronous offset jump because `getItemLayout` is
provided):

```ts
useEffect(() => {
  if (!visible) return
  setFocusArmed(true)
  if (activeDisplayIndex > 0) {
    listRef.current?.scrollToIndex({
      index: activeDisplayIndex,
      animated: false,
    })
  } else {
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }
}, [visible])
```

Mount-lifecycle matters: `InPlayerMenu` is conditionally rendered
(`menuActive && menuOpen && <InPlayerMenu/>`) so it remounts per open and
mount-time `initialScrollIndex` suffices; `LanguagePanel` is a Modal and must
thread `visible` into the hook. Know which lifecycle each consumer has.

### 5. Stable callbacks into renderRow — hosts that re-render at ~1Hz

`VideoPlayer` re-renders on every `timeUpdate` (~1Hz during playback).
`closeMenu` flows into the shared hook's `renderRow` deps; an unstable identity
re-renders every mounted row each second while the menu is open. Make
open/close callbacks `useCallback`-stable and read host-supplied callbacks via
the latest-ref pattern:

```ts
// useSessionPlayback.ts
const onRequestRevealFocusRef = useRef(onRequestRevealFocus)
onRequestRevealFocusRef.current = onRequestRevealFocus
const closeMenu = useCallback(() => {
  menuOpenRef.current = false
  setMenuOpen(false)
  onRequestRevealFocusRef.current()
  scheduleHideRef.current()
}, [scheduleHideRef])
```

Same rule on the screen side: pass a stable `closePanel = useCallback(...)`
to panels instead of an inline `onClose={() => ...}` arrow.

### 6. Hardware Back must close the overlay menu, not playback

react-native-tvos bridges the tvOS Menu button into `'hardwareBackPress'`. A
`BackHandler` that dismisses the player without checking the menu state turns
the menu into a trap — Back exits playback entirely. Branch on the menu ref
first:

```ts
// VideoPlayer.tsx BackHandler
if (menuOpenRef.current) {
  closeMenu()
  return true // consumed — no stack pop, playback continues
}
```

## Why This Matters

User-visible consequences before the fixes: the sheet froze the TV for seconds
on open; rows and the Close button rendered outside the dialog (then the
intermediate "fix" hid Close entirely); focus teleported mid-browse; reopening
showed a stale scroll position; and Back over the in-player menu kicked the
viewer out of playback.

## When to Apply

- Any react-native-tvos `FlatList` inside a bounded panel/sheet/overlay menu.
- The list has a preferred-focus row (initial focus should land on a specific
  item).
- The container is an RN `Modal` toggled via `visible` (subtree stays
  mounted), or any wrapper that survives open/close.
- The host re-renders at high frequency (video `timeUpdate`) and passes
  callbacks into rows.
- Hardware Back should dismiss the overlay, not pop navigation.

## Examples

The complete working reference is
`apps/tv/src/components/watch/useVariantList.tsx` — the shared hook that
packages pitfalls 2-4 (one-shot focus, scroll-on-open, getItemLayout) in one
place, consumed by both `LanguagePanel` (Modal lifecycle, threads `visible`)
and `InPlayerMenu` (remounts per open, adds `headerHeight`).

## Related

- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`
  — the general TV pitfall catalog (off-screen `hasTVPreferredFocus` no-ops,
  absolute-position focus traps); this doc is the virtualized-list deep dive.
- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` —
  `TVFocusGuideView` + preferred-focus routing on static surfaces.
- `docs/solutions/best-practices/flashlist-v2-maintainvisiblecontentposition-default-20260605.md`
  — the mobile FlashList analog of scroll-state-on-reopen; if these TV panels
  ever migrate to FlashList, disable `maintainVisibleContentPosition` (the dub
  list is replaced wholesale per open).
- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md`
  — ref-mirror/stale-closure patterns in the same `VideoPlayer` overlay; the
  BackHandler and latest-ref rules here are instances of that class.
