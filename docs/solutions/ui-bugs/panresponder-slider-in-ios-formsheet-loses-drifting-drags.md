---
title: "A PanResponder slider in an iOS formSheet loses drifting drags: UIKit's scroll or sheet pan cancels the JS touch, so use the native slider"
date: "2026-09-29"
category: "ui-bugs"
module: "apps/mobile"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "medium"
symptoms:
  - "A slider drag with about 25 pt of vertical drift stops about 5 steps short of the finger"
  - "onPanResponderTerminate fires after about 10 pt of vertical drift, and the thumb freezes"
  - "A flat horizontal drag reaches its step, so a quick test does not show the bug"
  - "Returning false from onPanResponderTerminationRequest changes nothing"
  - "No unit test fails; only a simulator drag with drift shows the bug"
root_cause: "logic_error"
resolution_type: "dependency_update"
framework_version: "expo 57.0.24 (the tree moved to 57.0.25 on 2026-09-28), react-native 0.86.3 (Fabric), @react-native-community/slider 5.2.0"
related_components:
  - "apps/mobile/src/components/bible/sheets/ReaderStepSlider.tsx"
  - "apps/mobile/src/components/bible/sheets/ReaderSettingsSheet.tsx"
  - "apps/mobile/app/_layout.tsx"
  - "apps/mobile/package.json"
  - "pnpm-lock.yaml"
retire_when: "React Native or iOS lets a core PanResponder keep its touch when a parent UIScrollView or formSheet pan starts; check in a scratch Expo app with a PanResponder row in a formSheet ScrollView, dragged with 25 pt of vertical drift"
tags:
  - "mobile"
  - "ios"
  - "panresponder"
  - "gesture-conflict"
  - "formsheet"
  - "slider"
  - "react-native-community-slider"
  - "accessibility"
---

# A PanResponder slider in an iOS formSheet loses drifting drags: UIKit's scroll or sheet pan cancels the JS touch, so use the native slider

## Problem

The feat-553 Bible reader settings sheet needs two step sliders: text size (11 steps) and line spacing (5 steps). The first version was a JS step slider built on `PanResponder`. It lost its touch when the finger drifted up or down, so the thumb stopped short of the finger.

## Symptoms

- The sheet is an Expo Router iOS `formSheet` route (`apps/mobile/app/_layout.tsx`). Its body is a vertical `ScrollView`.
- On the iPhone 17 Pro Max simulator, a drag with about 25 pt of vertical drift stopped about 5 steps short.
- `onPanResponderTerminate` fired after about 10 pt of vertical drift.
- A flat horizontal drag worked. Quick tests with a flat drag did not show the bug.

## What Didn't Work

The React Native paths in this doc are relative to `apps/mobile/node_modules/react-native/` (0.86.3).

- **`onPanResponderTerminationRequest: () => false`.** React Native asks this callback only when another JS view wants the responder (`Libraries/Renderer/implementations/ReactFabric-dev.js:16430`). A native pan does not ask. React Native routes `topTouchCancel` straight to `onPanResponderTerminate` (`ReactFabric-dev.js:16538-16586`).
- **`scrollEnabled={false}` on the `ScrollView`.** The sheet's own drag (dismiss and detent) then took the touch.
- **react-native-gesture-handler.** It can claim a touch natively, but `apps/mobile` excludes it from autolinking (`apps/mobile/package.json`, `expo.autolinking.exclude`), because it crashes Expo Go.

## Solution

Use the native `@react-native-community/slider`, version 5.2.0. Expo SDK 57 pins this version (`apps/mobile/node_modules/expo/bundledNativeModules.json`). The wrapper is `apps/mobile/src/components/bible/sheets/ReaderStepSlider.tsx`. It is on the follow-up branch to #2427, unmerged as of this writing.

```tsx
// The native slider sends onValueChange for each move, so send each new step once.
const sent = useRef(value)
useEffect(() => {
  sent.current = value
}, [value])
const onValueChange = (raw: number) => {
  const step = Math.min(Math.max(Math.round(raw), 0), last)
  if (step === sent.current) return
  sent.current = step
  onChange(step)
}

;<Slider
  minimumValue={0}
  maximumValue={last}
  step={1}
  value={value}
  onValueChange={onValueChange}
  tapToSeek
  accessibilityLabel={label}
  accessibilityUnits={unit} // a plural unit, such as "points"
  accessibilityIncrements={spokenValues.map(String)}
/>
```

### Library traps in 5.2.0 (read from the installed source)

The paths below are relative to `apps/mobile/node_modules/@react-native-community/slider/`.

1. **`StepMarker` cannot put tick dots under the thumb.** The library draws the markers in a JS row above the native slider (`src/utils/styles.ts:19`, `zIndex: 2`). The row uses a fixed side margin of 5% of the width (`src/components/StepsIndicator.tsx:43`, `src/utils/constants.ts:5`). No position comes from the native thumb, so the markers do not line up. The app ships no tick dots.
2. **Android needs whole-number strings in `accessibilityIncrements`.** Android casts each entry to `String` (`android/.../ReactSliderManagerImpl.java:130`) and calls `Integer.parseInt` on it (`android/.../ReactSlider.java:210`). A number entry fails the cast, and `"1.2"` makes `parseInt` throw. So the app speaks line spacing as percents (120–160), not as factors.
3. **A spoken value of 1 removes the last letter of the unit.** Both platforms do this (`ReactSlider.java:210-211`, `ios/RNCSlider.m:50-51`). iOS uses `intValue`, so `"1.2"` also counts as 1 there. Use a plural unit and never speak 1.
4. **The entry count must match the range.** Both platforms use the entries only when the count minus 1 equals the maximum value (`ReactSlider.java:205`, `RNCSlider.m:44`). Keep `minimumValue={0}` and `maximumValue={count - 1}`.

## Why This Works

A JS slider depends on React Native touch events. When a UIKit pan starts, UIKit cancels the touch, and JS cannot refuse the cancel. React Native's `ScrollView` lets its pan cancel touches in its content views (`React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm:730-734`). So a JS view inside it has no protection.

A native `UISlider` tracks the touch in UIKit. In this session's simulator tests, the parent pans did not take the touch from it during a drifted drag. The `ScrollView` rule above does not explain this, because it returns YES for a `UIControl` too. This doc does not name the exact UIKit rule; the simulator test is the proof. The test passed again on 2026-09-28 on a new iPhone 17 Pro Max simulator: a drag with about 23 pt of drift moved the thumb to the target step.

## Prevention

- **Keep drag controls in a sheet native.** Any drag control inside a `formSheet` or a vertical `ScrollView` must be a native control. If it is a JS control, test it with a drag that has at least 25 pt of vertical drift.
- **Reproduce the drift with idb.** A flat drag (same `y`) does not show the bug. Compare the final step with the target step.

  ```bash
  idb ui swipe --udid <sim> --duration 1.0 <x1> <y> <x2> <y+25>
  ```

- **Do not use `onPanResponderTerminationRequest` against a native gesture.** It only decides between JS responders.
- **Keep the lockfile change small.** Pick the version with `npx expo install`, as [expo-doctor-sdk54-health-checks-mobile-v2-20260409.md](../build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md) says. Then read the `pnpm-lock.yaml` diff. Here `pnpm add` also rewrote unrelated lines, so only the 3 slider entries were kept. Prove the result with `pnpm install --frozen-lockfile --offline`. [pnpm-hidden-hoist-phantom-dependency-worklets-babel-metro-bundle-failure.md](../build-errors/pnpm-hidden-hoist-phantom-dependency-worklets-babel-metro-bundle-failure.md) explains why unrelated lockfile changes are dangerous.
- **Ship a native build before an OTA update.** A new native dependency moves the Expo fingerprint runtime version. See [eas-update-stakeholder-preview-setup.md](../mobile/eas-update-stakeholder-preview-setup.md).
- **Know the test limit.** `ReaderStepSlider.test.tsx` pins the step de-duplication and the whole-number increments. No jest test can show the drift bug.

## Related Issues

- [mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md](mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md): the same cause (a native UIKit pan wins over a JS `PanResponder`). There, a geometry split fixes it. In a sheet, the scroll and sheet pans cover the whole sheet, so no geometry split is possible.
- [paged-hero-overlay-chrome-touch-architecture.md](paged-hero-overlay-chrome-touch-architecture.md): the `PanResponder`-only rule for gestures on a background layer. Inside an iOS formSheet, that rule does not hold a drifting drag.
- [rn-view-accessible-required-for-accessibilityrole.md](../mobile/rn-view-accessible-required-for-accessibilityrole.md): the accessibility work that a JS slider needs. The native slider gets the adjustable role from the platform.
- `apps/mobile/CLAUDE.md`, "Text size and line spacing are step sliders": the short form of this doc for the Bible reader.
