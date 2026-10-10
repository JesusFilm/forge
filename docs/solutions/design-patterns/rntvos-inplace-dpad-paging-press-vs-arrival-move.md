---
title: "In-place D-pad paging on a TV button: capturing the press without the arrival move (tvOS + Android TV)"
date: 2026-06-19
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A focusable TV button must consume a directional D-pad press as an in-place action (next/previous page) rather than a focus move, on both tvOS and Android TV"
  - "Using useTVEventHandler + self-targeted nextFocusLeft/nextFocusRight to keep focus on a button so it re-receives the directional key"
  - "The control must ignore the key press that MOVED focus onto it (tvOS fires onFocus before the TV event; Android fires the key before the focus move AND twice as key-down + key-up)"
  - "Synthetic focus/blur events flow through useTVEventHandler and must not be treated as page presses"
tags:
  - react-native-tvos
  - tvos
  - android-tv
  - dpad-navigation
  - focus
  - usetveventhandler
  - platform-os
  - event-ordering
  - hero-carousel
related_components:
  - "apps/tv/src/components/home/HomeHeroCarousel.tsx"
---

# In-place D-pad paging on a TV button: capturing the press without the arrival move (tvOS + Android TV)

## Context

A home hero carousel (`apps/tv/src/components/home/HomeHeroCarousel.tsx`) has two focusable action buttons — a crimson "See more" CTA on the left and a white next-slide chevron on the right. They are real focus neighbours, so the TV focus engine moves between them with D-pad Left/Right. The goal: when the chevron is **already** focused, D-pad Right advances the carousel; when "See more" is **already** focused, D-pad Left goes back. The trap: the directional key that _moves focus onto_ a button must NOT also page.

This is harder than it looks because tvOS and Android TV deliver the relevant events in **different orders**, Android **double-fires** every press, and synthetic focus/blur events share the same channel as real keys. Four reasonable-looking approaches each failed:

- **Attempt 1 — "arm on focus, consume the first press" (a per-button `armedRef`).** Broke when focus arrived via a path other than the expected direction (e.g. D-pad Down from the top bar geometrically lands on the chevron): the first deliberate press after an out-of-direction arrival was silently eaten.
- **Attempt 2 — sync the "focus moved" flag in a `useEffect` instead of in `onFocus`.** React flushes effects _between_ the native `onFocus` and the `useTVEventHandler` callback, so the flag was already set when the handler ran — the focus-move press still paged.
- **Attempt 3 — denylist synthetic `focus`/`blur`/`pan` at the top of `onTVEvent`** (borrowed from a sibling `VideoPlayer`). Broke the _previous_ direction: the self-target re-focus emits a synthetic `blur`+`focus` pair on a stay-put press, and that pair is exactly what _clears_ the focus-moved flag. Denylisting it left the flag stuck and ate the press. The synthetic-event clearing is **load-bearing** here.
- **Attempt 4 — un-gated `eventKeyAction === 1` skip** (drop key-up everywhere). tvOS sends `-1`/`undefined` for `eventKeyAction`, so an un-gated skip suppressed real tvOS presses. The guard must be gated strictly to Android.

## Guidance

**Rule 1 — set `focusMovedRef = true` in BOTH `onFocus` AND `onBlur` of every button in the group.** Any focus transition (in, out, or between buttons) flags the ref. Partial flagging leaves a stale-flag gap.

```tsx
const handleChevronFocus = useCallback(() => {
  chevronFocusedRef.current = true
  focusMovedRef.current = true // flag on every focus arrival
  setChevronFocused(true)
}, [])
const handleChevronBlur = useCallback(() => {
  chevronFocusedRef.current = false
  focusMovedRef.current = true // flag on every focus departure
  setChevronFocused(false)
}, [])
```

**Rule 2 — in `onTVEvent`, read and clear `focusMovedRef` on every event, then suppress ONLY on iOS.** On iOS the button's `onFocus` fires before `useTVEventHandler`, so a focus-move key reaches the handler with the button already focused — suppress it. On Android the key arrives _before_ the focus moves, so the focus-ref gate (`chevronFocusedRef.current`) already rejects a focus-move press and `focusMovedRef` is stale — ignore it there.

```tsx
const moved = focusMovedRef.current
focusMovedRef.current = false // clear on every event, not just when suppressing
if (Platform.OS !== "android" && moved) return
```

**Rule 3 — drop the Android key-up duplicate, gated strictly to Android.** Android's `ReactAndroidHWInputDeviceHelper` dispatches every physical press twice — `eventKeyAction === 0` (down) then `1` (up) — with the same `eventType`. tvOS sends `-1`/`undefined`, so the gate must be platform-specific.

```tsx
if (Platform.OS === "android" && event.eventKeyAction === 1) return
```

**Rule 4 — do NOT denylist synthetic `focus`/`blur` events.** They flow through `useTVEventHandler` and clear `focusMovedRef`, which is what lets the _first real key after focus settles_ page correctly, and the end-button self-target re-focus depends on them. (Denylisting synthetic events is correct only for controls that do not rely on them to reset state — e.g. an overlay state machine.)

**Rule 5 — self-target `nextFocusLeft`/`nextFocusRight` on each end button.** When a button has no real neighbour in a direction, a press that way should stay put rather than escape the group; the handler turns that stay-put press into a page. The self-target is what distinguishes a deliberate page press from a focus-move press.

```tsx
nextFocusLeft={selfNode ?? undefined}   // leftmost button: Left stays put -> page back
nextFocusRight={selfNode ?? undefined}  // rightmost button: Right stays put -> page forward
```

## Why This Matters

- **iOS event ordering:** `onFocus` fires synchronously _before_ `useTVEventHandler` for the key that caused the move. By the time the handler sees `right`, the chevron is already focused — a naive "is it focused?" gate fires on the focus-move press.
- **Android event ordering:** the directional key reaches the handler _before_ focus has moved, so the focus-ref gate correctly rejects a focus-move press. `focusMovedRef` carries state from the _previous_ transition and must be ignored on Android.
- **Android double-fire:** each physical press emits key-down (`0`) then key-up (`1`) with the same `eventType`; without the key-up guard every press pages twice.
- **Synthetic events are load-bearing:** the end-button self-target causes a synthetic `blur`+`focus` pair on a stay-put press; that pair sets and then clears `focusMovedRef`, resetting the handler so the next deliberate press pages. Blocking synthetic events breaks the reset cycle.
- **`useEffect` runs after native callbacks:** React flushes effects between the native `onFocus` and the TV-event callback, so any flag-sync placed in a `useEffect` runs too late — the handler sees the flag already set and suppresses the focus-move press on _every_ platform, not just iOS.

This is the boundary condition that complements [`rntvos-video-overlay-async-native-event-patterns`](./rntvos-video-overlay-async-native-event-patterns-2026-04-23.md): that doc denylists synthetic `focus`/`blur`/`pan` for an overlay state machine; this pattern shows that denylist must NOT be applied to a paging control, where the synthetic events are load-bearing flag-clearers.

## When to Apply

Apply when ALL of these hold:

1. A react-native-tvos component (tvOS or Android TV) has one or more focusable buttons that should respond to a directional D-pad press **in-place** (the button has no real neighbour that direction, or the press should act rather than move focus).
2. The same directional key can also _arrive at_ that button by moving focus from a real neighbour.
3. The component must run on both tvOS and Android TV.

Concrete triggers: carousel end buttons where Left/Right should page rather than escape; a "load more" button where Down should load rather than leave the list; any "press that focuses must not also activate" control.

Do **not** apply on a tvOS-only component (the Android guards are noise there). Do **not** denylist synthetic `focus`/`blur` as a simplification — that breaks self-target re-focus.

## Examples

### Before — naive focus-ref gate only (paged on the focus-move press on iOS)

```tsx
const onTVEvent = useCallback(
  (event) => {
    if (event == null) return
    // On iOS chevronFocusedRef is already true when the handler runs, so the
    // Right that MOVED focus here is treated as a deliberate page press.
    if (event.eventType === "right" && chevronFocusedRef.current) {
      onRequestAdvance(1)
    }
  },
  [onRequestAdvance],
)
```

### After — the working shape

```tsx
const onTVEvent = useCallback(
  (
    event: { eventType?: string; eventKeyAction?: number } | null | undefined,
  ) => {
    if (event == null) return

    // Android emits each D-pad press twice (key-down=0 + key-up=1) with the same
    // eventType; drop the key-up so a press pages once. Gated to Android so a
    // non-zero action value on tvOS can't suppress a real key.
    if (Platform.OS === "android" && event.eventKeyAction === 1) return

    // A directional key that just changed focus also fires here. On iOS, onFocus
    // runs BEFORE this handler (so the key reads as focused) -> suppress the
    // focus-move press. On Android the key arrives BEFORE the focus move, so the
    // focus-ref gate below already blocks it and the flag would be stale.
    // Synthetic focus/blur events flow through and clear the flag; do NOT
    // denylist them -- they are load-bearing for the self-target re-focus reset.
    const moved = focusMovedRef.current
    focusMovedRef.current = false
    if (Platform.OS !== "android" && moved) return

    const type = event.eventType
    if (
      (type === "right" || type === "swipeRight") &&
      chevronFocusedRef.current
    ) {
      onRequestAdvance(1)
    } else if (
      (type === "left" || type === "swipeLeft") &&
      seeMoreFocusedRef.current
    ) {
      onRequestAdvance(-1)
    }
  },
  [onRequestAdvance],
)
useTVEventHandler(onTVEvent)
```

### Known residual limitation

On iOS, the first directional press after focus arrives via a **programmatic** path (`hasTVPreferredFocus` restore on back-navigation, or an explicit `focus()` call) is eaten — the programmatic `onFocus` sets `focusMovedRef`, and the handler treats the next key as a focus-move. It self-corrects on the following press. There is no clean fix without distinguishing programmatic from user-driven focus, which react-native-tvos does not expose. The whole scheme also rests on the onFocus-before-TV-event (iOS) / key-before-focus-move (Android) ordering — verify on **real Apple TV + Android TV hardware** (this pattern was verified in the tvOS simulator; the Android behavior is grounded in the react-native-tvos native source — `ReactAndroidHWInputDeviceHelper` double-dispatch and `RCTTVView` synthetic focus/blur — not yet device-tested).

## Related

- [`rntvos-video-overlay-async-native-event-patterns`](./rntvos-video-overlay-async-native-event-patterns-2026-04-23.md) — the sibling `useTVEventHandler` doc (stale-closure / ref-mirror trap + synthetic-event denylist for overlays). This pattern is the complementary boundary: paging controls must NOT denylist synthetic events.
- [`rntvos-dpad-player-chrome-patterns`](./rntvos-dpad-player-chrome-patterns.md) — the player scrubber's focus-mirror ref (`scrubFocusedRef`) is the same family of "was focus just moved here?" guard in a different context.
- [`tv-focus-driven-hero-patterns`](../best-practices/tv-focus-driven-hero-patterns-20260420.md) — the non-interactive hero / rail-owns-focus model this interactive paging hero evolved from.
- [`react-native-tvos-porting-pitfalls`](../best-practices/react-native-tvos-porting-pitfalls-20260414.md) — umbrella pitfalls; the iOS `onFocus`-before-TV-event ordering and the Android double-fire belong on its list.
