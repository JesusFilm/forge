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

## Inspect generated build scripts when moving a native project

Copied Xcode project files and matching Pods locks can still hide absolute paths
in `Pods/Target Support Files/Pods-JesusFilmWatch/expo-configure-project.sh`.
Inspect the generated scripts as well as project files before building; rebase
the provider output and entitlement input to the selected checkout. Preserve the
source project and signing identity. A fresh Debug build with `SKIP_BUNDLING=1`
proves native compilation, while current JavaScript needs separate runtime
evidence.

## Separate capture latency from application readiness

Android PNG capture/transfer took 0.8–1.1 seconds for a mostly black hero and
3.3–3.5 seconds for loaded artwork on the same emulator. A launch-to-OCR metric
included that overhead and accepted different visual completion states. Retain
the failure and inspect recorded frames offline with distinct Details, artwork
and focus milestones. Do not subtract overhead to manufacture a pass. Inspect
actual APK configuration, native executable sections and bundled functions;
matching local environment files alone do not establish artifact parity.

## Restore logical identity after asynchronous shelf insertion

An existing Continue Watching row concealed the Android return fault. A fresh QA
user reproduced it without deleting the original history: opening the fourth
Happy?: Trailer, naturally watching past 25%, and returning created the first
shelf above the curated rows and selected the first card instead.

`homeFocusRestore.ts` records section and card IDs independently of numeric row
positions or a remembered native node. Commit local shelf results together, wait
for the selected section's current layout and visible scroll position, then
request focus on its currently registered node. Preserve horizontal position.
Late callbacks must check live active/pending/identity state. Explicit activation
records the actual action even when no new focus event arrives. A fresh remote
action cancels deferred restoration; Android key releases are not fresh actions.
Chrome and hero activation clear stale rail identity. First mount retains Search.

Keep the existing measurement seam: compute the pure effect using the previous
Y, write the new Y once, then skip scroll effects while restoration is pending.
Do not weaken the read-before-write guard to accommodate a duplicate early write.

## Source maps do not prove Android asset compatibility

Reusing an existing APK's native payload with a worker-generated Hermes bundle
passed source-content checks yet rendered blank icons. Shared dependency symlinks
outside the worker changed generated `httpServerLocation` values and therefore
Android resource lookup names. Fourteen of 27 generated registrations no longer
matched native resources, including both icon fonts. Composed Hermes maps omitted
these virtual asset registrations.

Use the original project's release-JS build root, or an isolated dependency clone
with the same relative physical layout. Verify actual generated asset identifiers,
content hashes, scales and compiled resource names, alongside source maps,
configuration, signatures and ABI alignment. PNG bytes can differ after AAPT
processing; identify that representation difference explicitly. Test rendered
glyphs in a fresh profile so an old cache cannot conceal the mismatch. Preserve
invalid diagnostic artifacts; do not benchmark or distribute them as valid builds.
