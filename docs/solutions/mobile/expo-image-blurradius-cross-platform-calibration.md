---
title: expo-image blurRadius is not calibrated equally across iOS and Android
date: 2026-06-09
category: mobile
module: apps/mobile
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Applying expo-image's blurRadius to an Image seen on both iOS and Android (apps/mobile or apps/tv)"
  - "A blurred image looks right on one platform but too sharp or too heavy on the other"
related_components:
  - apps/tv
tags:
  - expo-image
  - blur-radius
  - platform-os
  - cross-platform
  - ios
  - android
  - react-native
---

# expo-image blurRadius is not calibrated equally across iOS and Android

## Context

The mobile Discover category cards render a faint, blurred video thumbnail
(`expo-image`) over a per-category gradient. A single `blurRadius={4}` looked
right on Android but visibly **too sharp** on iOS — the same numeric value
produced a much weaker blur on iOS than on Android. Matching the two required
different numbers per platform.

## Guidance

`expo-image`'s `blurRadius` is **not numerically calibrated the same on both
platforms** — Android's native blur is stronger per unit than iOS's. Do not
hardcode one value for a blur whose _amount_ matters. Use a platform-specific
radius:

```tsx
import { Platform } from "react-native"
import { Image } from "expo-image"

// expo-image's blurRadius blurs harder on Android than iOS for the same value.
const THUMBNAIL_BLUR_RADIUS = Platform.OS === "ios" ? 12 : 4

<Image source={url} blurRadius={THUMBNAIL_BLUR_RADIUS} contentFit="cover" />
```

The exact numbers are empirical — tune them by comparing a booted iOS simulator
and Android emulator on the same screen. For the Discover cards, iOS `12` matched
Android `4` (~3× at this range). Treat the ratio as a starting point, not a
constant: it is not guaranteed linear across the whole range.

## Why This Matters

A single `blurRadius` silently diverges. Pick the value that looks right on
Android and iOS comes out too sharp (recognizable frames where you wanted a soft
wash); pick the iOS value and Android comes out a muddy over-blur. Because each
platform looks fine on its own, the mismatch is **invisible until you put the two
side by side** — exactly the comparison that never happens if you only test one
simulator.

This is the _numeric-calibration_ sibling of the team's existing "always provide
a platform fallback for blur" convention, which is about blur **capability**
divergence (e.g., expo-blur not working in Expo Go on Android). Here both
platforms _can_ blur; the same number just means different strengths.

## When to Apply

- Any `expo-image` `blurRadius` on a surface seen on both iOS and Android
  (`apps/mobile` and `apps/tv`).
- Whenever a blurred image is a deliberate aesthetic (a soft background wash, a
  frosted card) where the _amount_ of blur matters — not a throwaway placeholder.

## Examples

Discover category card thumbnail, before/after:

```tsx
// Before — looked right on Android, too sharp on iOS:
<Image source={thumbnailUrl} blurRadius={4} contentFit="cover" />

// After — matched on both, verified side-by-side in the simulators:
const THUMBNAIL_BLUR_RADIUS = Platform.OS === "ios" ? 12 : 4
<Image source={thumbnailUrl} blurRadius={THUMBNAIL_BLUR_RADIUS} contentFit="cover" />
```

Verify by screenshotting both a booted iOS simulator and an Android emulator on
the same screen and comparing blur strength directly — the divergence does not
show from a single device.

## Related

- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — the
  sibling blur learning. Establishes the "platform-specific blur" convention, but
  for a different mechanism: expo-blur's `BlurView` (iOS-only, Android dim
  fallback) and the separate gotcha that RN-core `Image.blurRadius` does not
  render over an Android `VideoView`. Don't conflate the three blur surfaces —
  RN `Image.blurRadius`, **expo-image** `blurRadius` (this doc), and expo-blur
  `BlurView` are distinct; this learning is specifically about expo-image's
  `blurRadius` on a standalone thumbnail.
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` —
  same card-overlay UI family and the same meta-pattern: Expo visual props need
  empirically-tuned values, not the obvious default.
- `docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md`
  — the broader "iOS visual effect needs divergent Android handling" pattern
  (`platform-select`).
