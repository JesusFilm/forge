---
title: "Watch TV focused hero selection, Home Back ownership and Select gestures"
date: 2026-10-30
module: apps/tv
problem_type: ui_bug
tags: [android, apple-tv, focus, navigation, playback, remote]
---

## Focused presentation and activation must agree

The hero timer ran only while its actions were focused. Its logical index also
advanced before asynchronous artwork and independent copy animation settled.
Pause rotation during focused decisions and inactive routes. Keep the ambient
animation off the actions; when focus enters or a focused viewer pages, present
artwork and copy from one card together. Preserve native action nodes and
immediate activation. Silently dropping Select during a transition does not
satisfy intended-film activation.

See `apps/tv/src/components/home/heroInteractionState.ts`,
`HomeHeroCarousel.tsx`, and `apps/tv/app/index.tsx`.

## A JS Back handler alone does not claim tvOS Menu

Lower Home can consume Back, reveal top chrome, scroll to the top and request
focus on the actual Search node after that render. The first Apple repair still
exited: native Menu delivery was not enabled. Claim Menu only while active lower
Home owns it; release at top or blur so Search, details, player and the platform
retain their handlers. Cancel deferred focus requests on route changes.

## Own a physical Select press across focus changes

The owner approved first-hidden-OK pause after baseline testing showed the
documented reveal-then-toggle flow worked in normal-paced emulator cases. Record
that as an approved interaction change, not reproduction of the old device bug.

Native Select DOWN can change playback and move focus into controls. Its repeats
and UP remain owned by that gesture, preventing the newly focused child from
activating again. A fresh nonrepeat DOWN recovers from missing UP; inherited
repeats or orphan releases cannot activate hidden/root controls. Visible child
controls retain their own handling. Error Select reveals the exit action.
Directional reveal timeouts match both key and generation before clearing state.

`NativeSelectGesture.kt` is exercised by event sequences in
`NativeSelectGestureTest.kt`. Runtime proof remains necessary for focus,
rendering, pause and seek. Source-text assertions and emulator success do not
establish physical-device behavior.
