---
title: "Autostart veil gate strands viewers on a permanent spinner when backgrounding interrupts the load window"
date: "2026-08-12"
module: "apps/mobile"
problem_type: "logic_error"
category: "logic-errors"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "A permanent dimmed veil and spinner over the poster with no play button and no scrubber"
  - "applyPlay returns early when AppState.currentState is not active without latching, so the pending play call is silently dropped"
  - "The shared adapter's foreground resume only replays a video that was already playing, so a video still loading when the app backgrounds never resumes"
  - "sourceLoad fires once per source, so neither hasStarted nor loadFailed ever releases the awaitingAutostart gate"
  - "A source that wedges without ever emitting error also never releases the gate, because no watchdog is armed before first playback"
  - "The only recovery is to navigate away from the watch screen"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/components/watch/VideoPlayer.tsx"
  - "apps/mobile/src/hooks/useManagedVideoPlayer.ts"
  - "apps/mobile/src/hooks/useControlsVisibility.ts"
  - "apps/mobile/src/lib/autoHide.ts"
  - "apps/mobile/src/components/watch/__tests__/videoPlayerAutostart.test.ts"
tags:
  - "mobile"
  - "expo-video"
  - "react-native"
  - "video-player"
  - "appstate"
  - "autostart"
  - "loading-veil"
  - "gate-release"
  - "watchdog"
  - "failure-mode-enumeration"
---

# Hiding the only recovery affordance behind a gate: enumerate every path that fails to open it

All code in this document is on PR #1908 (`feat/mobile-watch-ui-polish`).
The PR is open and not merged at the time of writing.

## Problem

The mobile watch screen autostarts its video. The transport chrome (a play
button and a scrubber) stayed pinned open during the load, because
`shouldArmHideTimer` refuses to arm the auto-hide timer while the player is
paused (`apps/mobile/src/lib/autoHide.ts:29`). The viewer therefore saw a play
button and a `0:00` scrubber for a video that was about to start by itself. That
reads as broken.

The first fix suppressed both chrome layers while an autostarting player waited
for its first frame, and showed a dimmed veil with a spinner over the poster
instead. The gate is one boolean, `awaitingAutostart`
(`apps/mobile/src/components/watch/VideoPlayer.tsx:184`). As first shipped it
had two release conditions: `hasStarted` (playback began) and `loadFailed`
(`status === "error"`).

Two conditions describe success and failure. They do not describe _neither_. A
code review found two paths where the load ends in neither state, and the gate
stays closed for the life of the screen. The gate hides the only controls the
viewer has, so a closed gate is not a cosmetic defect — it is a dead screen.

### Path 1 — the app goes to the background during the load window

Three separate mechanisms each decline to act, and together they strand the
viewer:

1. `applyPlay()` returns before it latches when the app is not active
   (`VideoPlayer.tsx:257`). This is correct on its own: the player must never
   start audio the viewer cannot see.
2. The `sourceLoad` event fires once per source, so it never re-fires
   (`VideoPlayer.tsx:276`).
3. The adapter's foreground handler replays only a video that was ALREADY
   playing when the app left, through `wasPlayingRef`
   (`apps/mobile/src/hooks/useManagedVideoPlayer.ts:231-247`). A video that never
   started is not covered.

Playback never begins, so `hasStarted` stays false. No error occurs, so
`loadFailed` stays false. The veil holds until the viewer leaves the screen.
Before this feature the same interruption left a visible play button, which the
viewer could press.

### Path 2 — the load wedges without an error

A source that stays in `loading` and never emits `error` also releases nothing.
No upstream watchdog covers it:

- The playhead stall watchdog in the adapter returns immediately unless the
  player is playing (`useManagedVideoPlayer.ts:306`), so it never arms before
  the first frame.
- `useControlsVisibility`'s `MOUNT_FALLBACK_MS` timer calls `scheduleHide`
  (`apps/mobile/src/hooks/useControlsVisibility.ts:286`). It only ever arms a
  HIDE. It cannot reveal anything.

### Path 3 — a tap during the veil consumed the chrome (lower severity)

The full-bleed tap target is a `Pressable` that was NOT gated on
`awaitingAutostart`, although both chrome layers were
(`VideoPlayer.tsx:426-435`, `VideoPlayer.tsx:458` and `VideoPlayer.tsx:492`). A
tap during the veil therefore ran the deferred single-tap branch and resolved to
`controls.hide()`. The hide completed against chrome the viewer could not see.
Playback then started with no chrome. One further tap recovered it, because
`revealIfHidden` runs on press-in (`VideoPlayer.tsx:334`).

## Symptoms

- The poster keeps a dimmed veil and a spinner forever. No controls appear.
- The reproduction is ordinary: start a video, background the app while it
  loads, return.
- No error is logged, because no error occurred. The player is simply idle.
- The only recovery is to navigate away from the watch screen.
- The Jest suite stayed green throughout. It could not see this.

## What Didn't Work

Each item below looked like cover for the gap. None of it was.

- **"Success or error is exhaustive."** It is not. The interesting state is
  neither. Every hazard in this document sits in that third state.
- **"The adapter already handles AppState."** It does, for the case it was built
  for: pause on background, resume what was playing
  (`useManagedVideoPlayer.ts:233-258`). An autostart that never started has
  nothing to resume, so the adapter correctly does nothing.
- **"`sourceLoad` will fire again."** It fires once per source
  (`VideoPlayer.tsx:276`). A retry needs its own trigger.
- **"A watchdog upstream will catch a wedged load."** Both candidates are
  disqualified by their own arming conditions. The stall watchdog needs
  `isPlaying`. The controls fallback only schedules a hide.
- **"The tap target is live, so the viewer can always recover."** The tap was
  live and made the state worse, not better.
- **"The tests would have caught it."** `apps/mobile` has no component-render
  harness (no `@testing-library/react-native`) and no e2e framework. Its tests
  are deliberate source-shape string assertions, stated in the header of
  `apps/mobile/src/components/watch/__tests__/videoPlayerAutostart.test.ts:1-14`.
  Those assertions pin structure. They cannot execute a release path, so a
  missing release path is invisible to them by construction.

  **Superseded 2026-08-15 (`apps/mobile` only).** `apps/mobile` now has a
  component-render harness, and it needed no new dependency —
  `@testing-library/react-native` is still absent. See `apps/mobile/CLAUDE.md`,
  section "Component render tests". A release path like this one is now
  provable in CI. The paragraph above stays as the record of why the defect
  reached a device.

- **Subscribing `statusChange` per source.** The first version keyed the
  listener on `[player, streamingUrl]` and reset `loadFailed` inside the same
  effect. That tears the listener down and rebuilds it across the seed to
  canonical swap while `replaceAsync` is still in flight, so a pre-swap error
  can be attributed to the new source. It also reset the flag to a bare `false`,
  which loses a source that already failed before the effect ran.

## Solution

Four changes, all in
`apps/mobile/src/components/watch/VideoPlayer.tsx` on PR #1908.

### 1. Retry the latch when the app returns to the foreground

Before:

```tsx
const onSourceLoad = () => {
  applySeek()
  applyPlay()
}
const sub = player.addListener("sourceLoad", onSourceLoad)
if (autoPlayedRef.current) applySeek()
return () => sub.remove()
```

After (`VideoPlayer.tsx:271-294`):

```tsx
const onSourceLoad = () => {
  sourceLoadedRef.current = true
  applySeek()
  applyPlay()
}
const sub = player.addListener("sourceLoad", onSourceLoad)
// applyPlay bails without latching while backgrounded, sourceLoad fires
// once per source, and the adapter's foreground resume only replays a
// video that was ALREADY playing — so nothing else retries this. Without
// the retry, backgrounding through the load window leaves the veil up for
// good.
const appSub = AppState.addEventListener("change", (next) => {
  if (next !== "active" || !sourceLoadedRef.current) return
  applySeek()
  applyPlay()
})
if (autoPlayedRef.current) applySeek()
return () => {
  sub.remove()
  appSub.remove()
}
```

`sourceLoadedRef` is a new ref that resets with the source
(`VideoPlayer.tsx:229` and `VideoPlayer.tsx:233`). It stops the retry from
calling `play()` on an item that is not ready.

### 2. Add a timeout backstop for a load that neither starts nor errors

`VideoPlayer.tsx:47-48` and `VideoPlayer.tsx:191-198`:

```tsx
// How long the pre-autostart veil may hold before it gives the chrome back.
const AUTOSTART_VEIL_TIMEOUT_MS = 12000

// Backstop for a load that neither starts nor errors. Releasing early only
// reveals chrome sooner, so a false positive on a slow network is harmless —
// being stuck with no controls is not.
useEffect(() => {
  if (!awaitingAutostart) return
  const t = setTimeout(() => setLoadTimedOut(true), AUTOSTART_VEIL_TIMEOUT_MS)
  return () => clearTimeout(t)
}, [awaitingAutostart])
```

The gate gains a third release operand (`VideoPlayer.tsx:184-189`):

```tsx
const awaitingAutostart =
  autostart &&
  !hasStarted &&
  streamingUrl != null &&
  !loadFailed &&
  !loadTimedOut
```

### 3. Skip the deferred single-tap hide while the veil is up

`VideoPlayer.tsx:351-360`. The new guard sits above the pre-existing R3 rule,
so the reveal-on-press-in behaviour is unchanged:

```tsx
singleTapTimerRef.current = setTimeout(() => {
  singleTapTimerRef.current = null
  // Single tap resolved: hide only if chrome was already up; if it was
  // hidden it was just revealed on press-in, so leave it visible (R3).
  // Skipped while the veil is up: the chrome is unmounted, so this would
  // hide something invisible and playback would then start with no
  // controls until the viewer taps again.
  if (awaitingAutostart) return
  if (singleTapAction(wasVisible) === "hide") controls.hide()
}, DOUBLE_TAP_MS)
```

The `Pressable` itself stays ungated on purpose. It still drives the double-tap
seek. The deferred hide is the part that must skip.

### 4. Subscribe `statusChange` once per player, and seed the reset from the real status

Before:

```tsx
useEffect(() => {
  setLoadFailed(false)
  const sub = player.addListener("statusChange", ({ status }) => {
    setLoadFailed(status === "error")
  })
  return () => {
    /* sub.remove() in try/catch */
  }
}, [player, streamingUrl])
```

After — one listener keyed on the player (`VideoPlayer.tsx:149-163`), and a
separate reset keyed on the source (`VideoPlayer.tsx:165-177`):

```tsx
// New source: clear both stop conditions. Seeding from the CURRENT status
// rather than a bare false covers a source that already failed before this
// effect ran, which a listener alone never sees.
useEffect(() => {
  let current: VideoPlayerStatus | null = null
  try {
    current = player.status
  } catch {
    // Player already released
  }
  setLoadFailed(current === "error")
  setLoadTimedOut(false)
}, [player, streamingUrl])
```

## Why This Works

The gate now has three release operands, and each one covers a different
terminal state: `hasStarted` for success, `loadFailed` for a reported failure,
and `loadTimedOut` for everything else. The third operand is the one that makes
the set complete, because it does not depend on the player reporting anything.

The foreground retry is safe to call repeatedly. `applyPlay()` returns
immediately once `autoPlayedRef` latches (`VideoPlayer.tsx:253`), and
`applySeek()` returns once `resumeSeekedRef` latches
(`VideoPlayer.tsx:239`). Both latches reset only with the source
(`VideoPlayer.tsx:230-234`). The retry therefore starts a video at most once per
source, and `sourceLoadedRef` keeps it from acting before the item is ready.

The timeout is asymmetric in cost, and the code says so. A false positive on a
slow network reveals the chrome a few seconds early, and the viewer sees a play
button for a video that then starts. A false negative leaves the viewer with no
controls at all. 12 seconds sits above a normal HLS start on a poor network and
well below the point where a viewer decides the app is broken.

Moving the `statusChange` listener to `[player]` matches how the adapter's own
QoE listener is scoped (`useManagedVideoPlayer.ts:282-294`). The source-keyed
effect now does one job: reset the two stop conditions, and seed `loadFailed`
from `player.status` so a source that failed before the effect ran is not
treated as healthy.

## Prevention

**The law: when a gate hides the only recovery affordance, enumerate every path
by which the gate can fail to open. A "success OR error" pair misses "neither".**

A gate that hides decoration can afford an incomplete release set. A gate that
hides the controls, the retry button, the error message, or the way out cannot.
The failure is silent by construction: nothing throws, nothing logs, and the
user-visible state is a spinner, which is the same thing a healthy slow load
looks like.

Apply this checklist to any gate of that kind:

1. **Name the terminal states, then count them.** Success and error are two.
   Write down the third: the operation that neither completes nor fails. If you
   cannot name a mechanism that releases the gate in that state, you do not have
   one.
2. **Add a time-based backstop, and state the asymmetry in the code.** A gate
   with no unconditional release is a gate with an unbounded closed state. The
   comment must say which direction a false positive errs in, so the next
   reader does not "tighten" the timeout back into a hazard.
3. **Test every release path against a lifecycle interruption, not only against
   the happy path.** Background the app, rotate the device, lock the screen, and
   lose the network — each during the gated window, not before or after it. The
   background transition is the cheapest one to run and it found this defect.
4. **Do not inherit a guarantee from an upstream watchdog. Read its arming
   condition.** Both candidate watchdogs here read as cover in prose and are
   disqualified by one line each: `if (!isPlaying) return`
   (`useManagedVideoPlayer.ts:306`) and a fallback that only calls
   `scheduleHide` (`useControlsVisibility.ts:286`). A watchdog that arms on the
   state your fault suppresses is not a watchdog for your fault.
5. **Gate the input surface with the same predicate as the output surface, or
   record why not.** Two chrome layers were gated and the tap target was not.
   Where a deliberate asymmetry is correct, put the reason next to the ungated
   surface, and gate the specific action instead (here, the deferred hide).
6. **Do not read a green suite as evidence about a release path when the suite
   cannot execute one.** `apps/mobile` tests are source-shape assertions by
   design. They can pin that a release operand EXISTS. They cannot prove that
   the set of operands is complete. For this class of change, the discriminating
   evidence is a simulator run with the interruption applied, and it must be
   recorded as such.

   **Superseded in part, 2026-08-15.** The premise changed: `apps/mobile` now
   has a component-render harness, and it needed no new dependency. See
   `apps/mobile/CLAUDE.md`, section "Component render tests". A release path
   like this one is provable in CI, so write that test rather than skip it. The
   lesson itself still holds — a suite that cannot execute the path says nothing
   about the path, and a simulator run stays the acceptance evidence for
   anything with real timing in it. This is the same note as the one on "The
   tests would have caught it" above.

This is the same shape as the repo's mocked-shape-versus-real-contract
discipline: a test that asserts the presence of a branch says nothing about
whether the branches cover the input space. Here the input space is the set of
ways a load can end.

## Related

- [Liveness watchdog armed on the success of the fault it detects](liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md)
  — the same meta-pattern in `apps/tv`, one step earlier in the lifecycle: there
  the watchdog's ARMING condition was suppressed by the fault; here the gate's
  RELEASE conditions were incomplete. That doc's lesson (never arm a backstop on
  the success signal the fault suppresses) is what `AUTOSTART_VEIL_TIMEOUT_MS`
  follows by arming unconditionally on the waiting state.
- [Mobile auto-hide overlay fade-race](../design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md)
  — the same chrome-visibility subsystem (`useControlsVisibility`,
  `VideoPlayer`). Path 3's tap guard exists so a tap landing during the veil
  does not fight that hook's reveal/hide state machine.
- [tvOS AppState teardown must branch on "background", not "!== active"](../ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md)
  — the inverse direction of the same concern. That doc is about teardown
  misfiring on a transient interruption; this one is about recovery never firing
  after a real one. AppState branching around `expo-video` needs care both ways.
- [Mocked-shape versus real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — the meta-note this learning is an instance of.
