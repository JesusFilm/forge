---
title: "TV startup logo flickers when an animated image is replaced with its still"
date: "2026-10-08"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: startup_logo
symptoms:
  - "The red logo disappears briefly at the animation-to-still handoff"
root_cause: image_remount
resolution_type: code_fix
severity: medium
tags: [tv, tvos, startup, expo-image, animation, flicker]
---

## Cause and fix

`apps/tv/src/components/LogoAnimation.tsx` used hold state in both the Image key
and source. At 4.4 seconds, it destroyed the animated WebP view and created a
static PNG view, leaving a blank while that view decoded/drew its first frame.

Keep the animated view and source mounted. Pause it through the Expo Image ref's
`stopAnimating()` instead. The installed tvOS SDAnimatedImageView implementation
pauses its frame player, preserving the current displayed frame. Continue using
the static asset for reduced motion, inactive previews and background state;
clear the timer when the component unmounts or its playback conditions change.

Do not fix a visual handoff by delaying Home, adding a second animation wait, or
changing startup audio. The existing startup completion gate owns that timing.

## Verification

The user's recording contains two blank 60-fps samples at 7.683–7.700 seconds.
The rebuilt Apple TV 4K simulator recording contains no blank samples in its
three-second handoff window, and continues to populated Home. The isolated PR
branch passed 147 suites / 1,986 tests, typecheck, lint and repository-wide
formatting; the broader donor branch had passed 162 suites / 2,107 tests.
The structural regression test
guards the stable key/source and imperative pause, not native rendering; keep
the frame-by-frame runtime check for future changes.

Evidence and remaining Android verification are recorded in
`docs/plans/2026-10-07-tv-animation-settings.md`. Simulator proof is not physical
Apple TV or Android runtime proof.
