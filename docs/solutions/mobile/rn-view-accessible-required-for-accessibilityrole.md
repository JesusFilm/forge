---
title: "RN View with accessibilityRole needs accessible={true} to reach the iOS a11y tree"
date: "2026-06-08"
category: mobile
module: apps/mobile
problem_type: ui_bug
component: apps/mobile/src/components/watch/Scrubber.tsx
severity: high
symptoms:
  - "Seek bar element absent from the idb describe-all accessibility tree on iOS"
  - "VoiceOver / Switch Control skip the scrubber entirely while sibling Pressable buttons (Play, Mute, Fullscreen) are reachable"
  - "accessibilityRole / accessibilityLabel / accessibilityValue / onAccessibilityAction set in JS but never surfaced to the native a11y layer"
  - "increment / decrement accessibility actions never fire; no runtime error or warning (silent)"
root_cause: wrong_api
resolution_type: code_fix
tags:
  - react-native
  - accessibility
  - voiceover
  - talkback
  - scrubber
  - video-player
  - ios
---

# RN View with accessibilityRole needs accessible={true} to reach the iOS a11y tree

## Problem

A custom video seek bar built as a plain `View` (with a `PanResponder` for drag) carried a full set of accessibility props but was **completely absent from the iOS accessibility tree**. VoiceOver, Switch Control, and `idb` automation could not reach it, and its increment/decrement actions never fired — the only way to seek was a touch drag, leaving assistive-tech users with no path to the control.

## Symptoms

- `idb ui describe-all` on the running app returned **no "Seek bar" element**, while every sibling `Pressable`-based control (Play, Mute, Fullscreen) appeared normally.
- VoiceOver skipped over the scrubber entirely.
- `onAccessibilityAction` (increment/decrement = ±10s) never triggered from assistive tech or automation.
- No runtime error or warning — the failure was silent.

## What Didn't Work

The static `/impeccable` design audit **and** the initial code review both _credited_ the scrubber as a positive accessibility implementation. Every prop was present and correct:

```tsx
<View
  accessibilityRole="adjustable"
  accessibilityLabel="Seek bar"
  accessibilityValue={{ min: 0, max: 100, now }}
  onAccessibilityAction={(e) => { /* increment/decrement = ±10s */ }}
  {...pan.panHandlers}
>
```

On paper the element looked complete, so reading the source never flagged it. **This class of defect is invisible to code review** — the iOS accessibility-element promotion is runtime behavior, not a prop-presence fact. There is nothing in the source to catch.

It was found only by inspecting the **live accessibility tree** in the simulator (auto memory [claude]): `idb ui describe-all` showed the "Seek bar" simply was not in the tree, while every adjacent `Pressable` button was. The contrast — buttons present, the `View`-based slider absent — is what pinpointed the missing `accessible`.

## Solution

Set `accessible` on the `View` (and declare `accessibilityActions` explicitly for Android TalkBack):

```tsx
<View
  accessible                                                       // ← promotes the View into the native a11y tree
  accessibilityRole="adjustable"
  accessibilityLabel="Seek bar"
  accessibilityValue={{ min: 0, max: 100, now }}
  accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}  // TalkBack registers these; iOS infers from the adjustable role
  onAccessibilityAction={(e) => { /* increment/decrement = ±10s */ }}
  {...pan.panHandlers}
>
```

After the fix, `idb ui describe-all` returned `role=AXSlider label='Seek bar' val='0%' height=44`; drag, seek, and the increment/decrement path all verified in the simulator (auto memory [claude]).

## Why This Works

`Pressable` and `TouchableOpacity` mark their underlying native view as an accessibility element implicitly — they are interactive by design, so React Native promotes them automatically. A plain `View` does **not** get that implicit promotion. Without `accessible={true}`, React Native writes the role/label/value/actions into the JS-side accessibility node but never flags the native view as an accessibility element, so iOS `UIAccessibility` never surfaces it to assistive technology.

`accessibilityActions` is not strictly required on iOS — the `adjustable` role implies increment/decrement — but Android TalkBack needs the array to enumerate the actions, so declaring it explicitly is the cross-platform-safe choice.

## Prevention

- **Prop rule:** any `View` carrying `accessibilityRole`, `accessibilityLabel`, `accessibilityValue`, or `accessibilityActions` must also set `accessible`. Without it, those props are dead weight.
- **Prefer `Pressable`** for anything interactive — it provides the implicit promotion, press feedback, and hit-slop. Reserve plain `View` + `accessible` for cases where gesture ownership (here, `PanResponder` — `react-native-gesture-handler` is forbidden under Expo Go) rules out `Pressable`.
- **Verify the tree, not the props** (auto memory [claude]): after any a11y change, run `idb ui describe-all` against the running simulator and confirm the element appears with the expected role/label/value. Typecheck and unit tests prove the props exist; only the live a11y tree proves the native layer sees the element.
- **Grep heuristic** for the silent-exclusion bug:
  ```bash
  grep -rn "accessibilityRole" apps/mobile/src | grep -v "accessible"
  ```
  Any `View` (not `Pressable`/`Touchable`) hit is a candidate.

## Related Issues

- `docs/solutions/mobile/decorative-icon-view-text-pattern.md` — the inverse concern: _hiding_ decorative `View`s from the a11y tree via `accessibilityElementsHidden` + `importantForAccessibility`. Together these cover the hide/show playbook for plain `View`s.
- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` — `accessible={false}` on a Pressable to suppress focus; opposite polarity, same promotion mechanism.
- `docs/solutions/mobile/audit-driven-video-detail-refactor.md` — removing a misleading `accessibilityRole="adjustable"` from a carousel; same role, same a11y-role-misuse theme.
- `docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md` — `Pressable` with `accessibilityRole="button"`; illustrates the implicit promotion a plain `View` lacks.
