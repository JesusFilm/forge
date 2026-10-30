---
title: "Android TV resume Modal receives focus without visible feedback"
date: "2026-09-05"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: native_android_player
symptoms:
  - "Keep watching has no visible highlight when the remote moves between choices"
  - "Resume's red selected check remains while native focus is actually on Cancel"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - android-tv
  - chromecast
  - modal
  - focus
---

## Evidence

On Chromecast, UIAutomator reported `focused=true` first on Cancel and then on
Start over after Up. Neither row changed visually. Select on Cancel dismissed
successfully, so the failure was focus feedback, not a dead click handler.

In installed react-native-tvos 0.81.5-2, `ReactViewGroup.onFocusChanged` does not
emit focus events. The app's Pressable patch listens to global TV focus events,
but `DialogRootViewGroup.requestChildFocus` forwarding to its TV input helper
is commented out. This distinguishes a Modal window from the activity root.

## Scoped fix

Android's `ResumeChoicePanel` delegates to the existing Kotlin choice dialog,
which paints white-fill focus directly from native list selection. Resume is
initially focused; Start over and Cancel retain their existing callback meanings.
Apple TV still uses the original React Native Modal.

The bridge returns one result after native dismissal. React ignores late results
after unmount and dismisses only its request id; module destruction closes any
remaining dialog. Tests cover all results, rejection, and unmount cancellation.
No React Native framework patch or player source change was needed.

## Verification rule

Check native `focused` separately from `selected` and from the painted highlight.
A red check is not proof of remote focus. Exercise all choices and reopen after
Cancel/Back; installation or a passing source guard is not UI proof. Coordinate
remote ownership with the user before testing, and restart any interrupted run.
