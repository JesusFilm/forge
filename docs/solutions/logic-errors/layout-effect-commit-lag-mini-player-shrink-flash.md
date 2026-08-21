---
title: "A layout effect's setState lands in the NEXT commit — the render in between needs its own answer"
date: "2026-08-21"
category: "logic-errors"
module: "apps/mobile"
problem_type: "logic_error"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "Pressing back from a video detail page shows the mini player already at its minimized corner size for one frame, then it snaps back to full size to begin the shrink animation"
  - "As the shrink completes, the window flashes back to full size for one frame before settling into the corner"
  - "Writing a static resting transform to overwrite the stuck native-driven ramp value did not help — Fabric keeps the native-driven value regardless of what React writes into the same prop, leaving the video scaled out of its box: a black window with live audio and live controls"
  - "Frame-transition tests stayed green after reverting each timing fix, because the existing assertions checked only that a park happened, not when it happened relative to the geometry commit"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/components/watch/PlaybackHost.tsx"
  - "apps/mobile/src/lib/miniPlayer/layout.ts"
tags:
  - "mobile"
  - "react-native"
  - "mini-player"
  - "video-player"
  - "commit-ordering"
  - "layout-effect"
  - "animated-value"
  - "call-order-assertion"
---

# A layout effect's setState lands in the NEXT commit — the render in between needs its own answer

## Problem

In React Native, a layout effect runs before its own commit paints, but the
`setState` it calls schedules a FURTHER commit. So when a store update triggers
the effect, one render sits between the store update and the state the effect
arms. Any render-time fallback that reads "no transition is armed yet" as
"settled" draws a wrong intermediate frame on that render.

`apps/mobile/src/components/watch/PlaybackHost.tsx` hit this in the mini-player
shrink (feat-367, shipped in PR #1962). The host owns the app's one player and
one video view. When the viewer leaves a watch page, the playback slot detaches
and the full-size player shrinks into a floating corner window. Both ends of that
transition drew a wrong single frame.

The fix is on branch `fix/mobile-watch-player-clip-routing-language-shrink` and
is open as PR #1980. It is NOT merged as of this writing. Lint, test and build
are green; the `expo-doctor` job fails on pre-existing upstream Expo patch drift
that is unrelated to the diff.

## Symptoms

The user reported a jerky, flashing back-navigation on device:

1. The player went black. For a moment the mini player appeared at the
   bottom-right corner ALREADY at its final minimized size.
2. That corner window vanished. The video jumped back to full size, and only
   then did the shrink animation run.
3. As the shrink completed, the window flashed back to full size for one frame
   before it settled into the corner.

### Measured evidence

Captured with `xcrun simctl io <udid> recordVideo`, then read per-frame with
`ffmpeg -vf "crop=...,signalstats,metadata=print"` over the corner region
(`lavfi.signalstats.YAVG`):

- Pre-fix, frame 129 is a LONE bright corner frame: `85.1 -> 122.7 -> 74.3` on
  three consecutive frames. The window painted at the corner for one frame, then
  disappeared again.

A temporary instrumented render trace (since removed) showed the two commits
directly:

```
t=...525  rect=null  motion=null  geom=185x104@243,757   <- CORNER (wrong)
t=...536  rect=null  motion=from   geom=440x248@0,62     <- FULL, shrink starts
t=...996  rect=null  motion=null  geom=185x104@243,757   <- settled
```

The slot detaching dropped `rect` at t=525. The layout effect armed `motion` at
t=536 — 11 ms and one painted frame later.

### Root cause: two halves of one commit-ordering fact

**Half 1, the opening artifact.** The detaching slot sets `rect` to null in a
`useSyncExternalStore` store. The layout effect that arms the shrink runs after
that commit, so its `setMotion(...)` lands in the next commit. The render in
between sees `rect == null` and `motion == null`. The geometry fallback chain
treated that pair as "settled" and returned the corner window frame, so the frame
drew the video already minimized. The armed motion then snapped it back to full
size to begin shrinking.

The file's own comment asserted the opposite, and that wrong claim is what let
the bug survive. Before this fix, the comment above that effect read: "A LAYOUT
effect: a passive effect runs after the commit paints... The motion state must
land before that paint." A layout effect does run before the paint of ITS OWN
commit. Its `setState` still schedules another commit, so it cannot make the
motion state land in the commit that dropped the rect. PR #1980 corrects the
comment to say so.

**Half 2, the closing artifact — and a genuine dilemma.** `settle()` parked the
native-driven ramp at its identity end (`shrink.setValue(0 | 1)`) BEFORE
`setMotion(null)` committed. For a from-anchored shrink the frame is still the
full player rect at that moment, so identity means "fill the full rect", and the
video snapped back to full size until the geometry commit landed.

The park is not gratuitous. The ramp is native-driven, and Fabric leaves the last
driven value on the view when the animated style detaches. A stale corner-target
transform pushes the settled window's video clean out of its box, which gives a
BLACK window with live audio and live controls. So two requirements looked
contradictory:

- Identity must reach the native node, or the stale transform survives and the
  window goes black.
- Identity must not land while the frame is still the full rect, or the video
  flashes full size.

The fix resolves this by changing only WHEN the same value is written — not
whether it is written, and not what writes it.

## What Didn't Work

### This run

The first fix attempt removed the park entirely. In its place it always wrote a
static identity transform on the video node (`motionStyle ?? RESTING_TRANSFORM`),
on the theory that a written transform overwrites the stuck native value.

It does not. Fabric keeps the native-driven value regardless of what React writes
into the same prop. The ramp's corner-target transform stayed applied on top of
the corner geometry, so the video was scaled and translated out of its box. The
user reported: "the pip player doesn't have anything playing in the frame. It's
just a black screen, and I can hear the audio playing still."

That attempt regressed the exact hazard the park exists to prevent. The revert
also deleted `RESTING_TRANSFORM` (no occurrence remains in `apps/mobile/src`),
because a resting-transform constant implies a guarantee Fabric does not give.

### Three days earlier, during the original build (session history)

Both artifacts were **already hit and partially fixed** while PR #1962 was being
built on 2026-08-18. Two approaches were tried and rejected then:

- **Parking the frame's geometry at the corner for the whole shrink** produced
  the exact artifact the user reported — "the untransformed frame = mini video at
  the corner = your bug." (session history)
- **Hiding everything during the transition** removed the flash by removing the
  animation: "the workaround hid everything (so no animation)." (session history)

## Solution

Four coordinated changes, all in `PlaybackHost.tsx` except the extracted pure
function.

**1. Answer the gap render explicitly.** A new `departingRect` — the rect the ref
still holds on that one render (`PlaybackHost.tsx:1012`) — feeds the geometry
chain. The frame holds the departing player rect until the motion is armed, and
that is also the shrink's own first frame, so the geometry never moves. The chain
is an exported pure function so the priority order is unit-testable
(`apps/mobile/src/lib/miniPlayer/layout.ts:243-263`):

```ts
if (args.rect != null) return args.rect
if (args.motion != null)
  return args.motion.anchor === "from" ? args.motion.from : args.motion.to
return args.heldWindowFrame ?? args.departingRect ?? args.windowFrame
```

`departingRect` ranks below an expand hold and above the resting window frame
(`layout.ts:262`).

**2. Defer the park instead of removing it.** `settle()` (`:656`) and
`clearMotion()` (`:628`) now record what the node is owed in a `pendingParkRef`
(`:579`). A separate `useLayoutEffect` keyed on the motion clearing applies it
(`:812-821`). That effect runs on the commit that DROPS the motion, by which
point the frame IS the corner, so identity means "fill the corner". It is the
same driver-written value at a later moment.

**3. Guard the deferred park against a same-commit replacement.** The park effect
is declared after the main motion effect, so React runs it second within one
commit. If that commit already armed a new motion, the park would land on top of
the fresh ramp. `AnimatedValue.setValue` STOPS a running animation, so the
transition would be skipped outright rather than merely mis-started. Verified in
the installed dependency, not a repo file: in `react-native@0.86.2`,
`setValue` opens with `if (this._animation) { this._animation.stop() }`
(`Libraries/Animated/nodes/AnimatedValue.js`, `setValue`, ~line 197 — inside
`node_modules`, so the line number moves with the RN version). The guard
therefore reads the ref, not the rendered state (`:816`):

```ts
if (motion != null || motionRef.current != null) return
```

The render cannot see the replacement motion yet, so `motionRef.current`
(`:583-587`) is the only readable answer. `runRamp` also clears any stale pending
park before it starts (`:644`), because a new ramp owns the node.

**4. Gate the chrome on the same predicate as the geometry.** The gap render also
carries the SETTLED window's chrome state, because `setChromeReady(false)` lands
a commit later too. The corner radius (`:1123`) and the mini transport (`:1191`)
are now gated on `settlingFromRect`, defined as `departingRect != null`
(`:1016`) — the same predicate the geometry uses. Without this, the fix only
relocates the one-frame artifact from the corner to full size.

## Why This Works

The commit boundary is a fact about React, not a bug to remove. So the fix does
not try to make the effect's state land earlier. It gives the render that sits in
the gap its own correct answer, and it moves the native write to the commit whose
geometry makes that write correct.

- The gap render now has an input that describes it (`departingRect`), instead of
  falling through to a value that describes a different state.
- The park writes the same value to the same node. Only its moment changed, so
  the black-window hazard stays closed.
- The ref-based guard resolves the ordering hazard the deferral creates. Within
  one commit the motion effect runs first and may arm a replacement, and only the
  ref reflects that.
- One predicate drives the geometry, the corner radius and the transport, so no
  layer can disagree with another about which state the frame is in.

### Why the park was safe when written, and stopped being safe

Session history supplies the missing link. When the identity park went in on
2026-08-18 it was placed, in the author's own words, "under the existing settle
hide" — a 0.1s hide-and-reveal then spanned the settle, so the park's timing was
invisible by construction.

That fade was removed the same day as a clean 79-line simplification, with a
green suite. The session explicitly predicted the consequence:

> "note the fade was also masking the end-of-shrink seam, so check closely
> whether you now see a **brief blink right as the shrink lands** (the video may
> flash back at full size ...)"

That is the closing artifact this doc fixes, reported by a user three days later.
Nothing about the park changed in between. Its cover was removed.

## Prevention

### Assert call ORDER, because both timing fixes revert through a green suite

An independent reviewer proved this empirically by reverting each mechanism and
re-running jest:

- Replacing the deferred park with a synchronous `shrink.setValue(...)` inside
  `settle()`/`clearMotion()`: every frame-transition test still passed. The
  existing park spy asserted only that a park HAPPENED, not when.
- Passing `departingRect: null` into `frameGeometry` from the host: every
  `PlaybackHost` test still passed. `frameGeometry.test.ts` covers the extracted
  pure function only, and nothing asserted that the host passes the value.

Removing each mechanism entirely does go red. Removing its TIMING does not.

The reason is the harness, and the mechanism is worth stating precisely: layout
effects already run synchronously as part of React's commit phase, with or
without a test harness. What `act()` adds is that it keeps draining scheduled
work until none remains (`flushActQueue`'s loop, in the installed
`react@19.2.3` development build). So the SECOND commit — the one the layout
effect's `setState` schedules — is flushed inside the same `act()` call, and by
the time any assertion runs, both commits have happened. No post-`act()` value
assertion can observe the ordering between them, because the end state is
identical either way.

The technique that discriminates: mock the pure geometry module so the function
becomes a spy while it keeps its real behaviour
(`PlaybackHost.test.tsx:112-115`).

```ts
jest.mock("../../../lib/miniPlayer/layout", () => {
  const actual = jest.requireActual("../../../lib/miniPlayer/layout")
  return { ...actual, frameGeometry: jest.fn(actual.frameGeometry) }
})
```

The spy then gives two handles, and the suite uses both
(`PlaybackHost.test.tsx:1435-1452`):

- **Call order** for the park. `mock.invocationCallOrder` on the geometry spy
  identifies the render that moved the frame, and the assertion is that the
  park's `setValue` ran after it (`:1587`):
  `expect(parked).toBeGreaterThan(lastGeometryOrder())`.
- **Per-call arguments at a chosen render** for the gap. Find the call where
  `rect == null && motion == null` — that IS the gap render — and assert what the
  host passed on it (`:1600-1604`):
  `expect(gapCall?.[0].departingRect).toEqual(RECT)`.

Both guards go red when their mechanism's timing is reverted. The suite marks
them in place as ordering guards (`:1557-1559`).

One more trap in the same area: adjacent tests were rewritten rather than added,
and two of them had pinned the OLD behaviour. One asserted that the docked frame
was clipped, and its title said "settles clipped at the rect". A test title that
states the defect is not coverage.

### Treat removing a masking layer as a change to everything it masked

The fade removal was a net simplification with a green suite, and it promoted a
latent ordering flaw to a user-visible one. Nothing it "changed" was broken — it
stopped hiding something that already was. When a diff deletes a cover (a fade, a
hide, a spinner, an opacity gate), re-verify the transitions underneath it rather
than only the deletion.

A predicted regression also needs an owner or a test, not a note. The exact
symptom was written down at the time and not followed up; a user found it three
days later. The call-order assertions above are the durable form of that
prediction.

### Gate every "no artifact" verification on proof that the scenario ran

The device verification took three iterations, because the first attempts were
vacuous:

- A recording reported "0 artifacts" where PLAYBACK NEVER STARTED. No session was
  published, so no window existed to flash. It was a clean result on a scenario
  that did not run.
- A brightness-based presence detector actually tracked the playing video's own
  content changing, not the window appearing or leaving.
- A spike detector whose bound was `|c-a| < 8` rejected the real flash
  (`85.1 -> 122.7 -> 74.3`, `|c-a| = 10.8`). It reported "0 excursions" for BOTH
  the fixed and the known-broken recordings.

The discipline that caught all three has two rules. Re-run every detector against
the known-broken capture, and treat a detector that cannot see the known defect
as broken. Then gate each take on positive proof that the scenario ran — playback
live, window present — before its "no artifact" result counts.

### Do not trust a mechanism claim in a comment

A wrong mechanism claim in a comment is worse than no comment, because every
later reader re-derives the wrong conclusion from it. The comment above the
motion effect asserted that a layout effect makes the motion state land before
the paint, and that claim is what let the gap render go unexamined for three
days. Verify a framework-behavior claim at the layer the claim is about — here,
by logging the actual render sequence — and correct the comment in the same
change, so the next reader inherits the finding instead of the error.

PR #1980 rewrites it to state what a layout effect does and does not guarantee,
and to name `departingRect` as the reason the gap needs its own answer.

## Related Issues

- [Occluding layers must share one gate predicate](occluding-layers-must-share-one-gate-predicate.md)
  — the shared-predicate law. Fix piece 4 above is that law applied to the
  geometry-and-chrome layer pair. Different mechanism: that doc is about two
  layers reading DIFFERENT predicates so one never releases; this one is about a
  transient wrong frame while every layer already agrees on the gate.
- [React StrictMode remount safety for hook-lifetime refs](react-strictmode-remount-safety-hook-lifetime-refs.md)
  — the corpus's other React-lifecycle timing hazard. Both correct a wrong
  assumption about when React's timing guarantees hold, and both needed a
  non-obvious test technique to prove it.
- [Mini player playbackRequest identity-compare render loop](../runtime-errors/mini-player-playbackrequest-identity-compare-render-loop.md)
  — same feature, same testing lesson: the defect lived in a render-cycle
  property, not a value, so only a frequency- or order-based assertion could see
  it.
- [RN Animated cleanup and React 18 review false positives](../best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md)
  — background on the Fabric native-driver semantics that make the identity park
  necessary rather than gratuitous.
- [Frame-diffing needs a motion-rich probe window](../conventions/verify-animated-media-motion-rich-probe-window.md)
  — prior precedent for the verification discipline above: a frame-diff detector
  can report clean for the wrong reason.
- [Mocked-shape-vs-real-contract discipline (META)](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — the META home for this doc's testing corollary. New worked instance: a
  synchronous test harness (`act()`) collapses a cross-commit ordering
  difference, so no value assertion can discriminate the fix.
- PR #1962 shipped the mini player (feat-367) and introduced both artifacts.
- PR #1980 carries this fix and is open, not merged.
