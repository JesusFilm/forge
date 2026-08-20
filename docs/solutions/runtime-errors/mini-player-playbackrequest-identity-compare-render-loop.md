---
title: "PlaybackRequest identity comparison on a merged cast field caused an infinite render loop"
date: 2026-08-19
category: runtime-errors
module: apps/mobile
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - 'Opening any video threw the React red-box "Maximum update depth exceeded"'
  - "Stack frames named playbackRequest.ts (the store's listener-notify loop) and PlayerSlot.tsx"
  - "Appeared immediately after merging origin/main (casting PR #1953) into the mini-player branch"
  - "Deterministic, and needed no Chromecast device: the idle-phase cast object is already non-null"
  - "Typecheck, lint, and the full jest suite all passed with the defect present"
root_cause: logic_error
resolution_type: code_fix
severity: high
framework_version: react-native 0.86.2
related_components:
  - apps/mobile/src/lib/miniPlayer/playbackRequest.ts
  - apps/mobile/app/watch/[slug].tsx
  - apps/mobile/src/hooks/useCastPlayback.ts
  - apps/mobile/src/hooks/usePlaybackFrame.ts
  - apps/mobile/src/components/watch/PlayerSlot.tsx
tags:
  - react-native
  - mini-player
  - casting
  - infinite-render-loop
  - referential-equality
  - state-store
  - usesyncexternalstore
  - test-fidelity
---

# PlaybackRequest identity comparison on a merged cast field caused an infinite render loop

## Problem

The mobile mini-player branch merged `origin/main` after main landed the Chromecast and AirPlay
casting work (PR #1953, commit `a4854f3c9`). The merge applied cleanly. Typecheck, lint, and the
unit suite stayed green. Every attempt to open a video then failed with a React red-box:
`Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside
componentWillUpdate or componentDidUpdate.`

The mini-player feature (feat-367) hoists the app's one `expo-video` player out of the routes. A
single host, `apps/mobile/src/components/watch/PlaybackHost.tsx`, mounts as a sibling of the
navigation shell that holds the `<Stack>` (`apps/mobile/app/_layout.tsx:365`). A route that wants
video renders `PlayerSlot` instead of a player. `PlayerSlot` is a transparent box that measures
itself in window coordinates and publishes a `PlaybackRequest` into a module-scope store
(`apps/mobile/src/lib/miniPlayer/playbackRequest.ts`). The host draws its one video view into the
measured rect.

`PlayerSlot` publishes from an effect with no dependency array, so the effect runs on every commit
(`apps/mobile/src/components/watch/PlayerSlot.tsx:119-124`):

```ts
// Every render, gated by the store's field-wise compare: the props are built
// from route state that re-renders for reasons the player does not care about.
useEffect(() => {
  const id = slotIdRef.current
  if (id != null) store.updateSlot(id, requestRef.current)
})
```

The only thing that keeps that effect quiet is the store's comparator. `updateSlot` returns before
it commits when the new request equals the old one
(`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:418-424`):

```ts
updateSlot(id: number, request: PlaybackRequest): void {
  const slot = slots.get(id)
  if (slot == null) return
  if (samePlaybackRequest(slot.request, request)) return
  slots.set(id, { request, rect: slot.rect })
  commit()
},
```

The merge added three fields to `PlaybackRequest` — `castActive`, `cast`, and `progressFeedRef` —
and three matching lines to `samePlaybackRequest`. Two of the three were correct. The third was an
identity comparison on a value the caller builds inline:

```ts
    a.castActive === b.castActive &&
    a.cast === b.cast &&
    a.progressFeedRef === b.progressFeedRef &&
```

The watch screen passes `cast` as a fresh object literal on every render
(`apps/mobile/app/watch/[slug].tsx:651-656`):

```tsx
cast={{
  playback: cast,
  onCastPress: handleCastPress,
  resolveMediaAt: resolveCastMediaAt,
  recovery: castRecovery,
}}
```

Its `playback` member is also fresh on every render. `useCastPlayback` ends with a bare object
literal and no `useMemo` (`apps/mobile/src/hooks/useCastPlayback.ts:260-273`).

The edge that closes the cycle is that the SCREEN subscribes to the same store. The watch screen
calls `usePlaybackFrameVisible()` at `apps/mobile/app/watch/[slug].tsx:116`, and that hook reads the
store through `useSyncExternalStore` (`apps/mobile/src/hooks/usePlaybackFrame.ts:13-17`).

The loop therefore runs like this:

1. The watch screen renders and builds a new `cast` literal.
2. `PlayerSlot`'s dependency-less effect calls `updateSlot` with the new request.
3. `samePlaybackRequest` fails on `a.cast === b.cast` and returns `false`.
4. The store commits and notifies every listener
   (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:381`).
5. `usePlaybackFrameVisible` re-renders the watch SCREEN.
6. Return to step 1.

Step 5 is unconditional, and that detail matters. `usePlaybackFrameVisible` derives a boolean, but
it subscribes to the snapshot OBJECT, with no selector and no equality function. The store rebuilds
that object whenever the version changes (`playbackRequest.ts:394-400`), `build()` returns a fresh
literal each time (`playbackRequest.ts:338-345`), and `commit()` increments the version
unconditionally (`playbackRequest.ts:373`). `useSyncExternalStore` compares snapshots with
`Object.is`, so every notification re-renders every subscriber even when the derived boolean is
unchanged.

## Symptoms

- Tapping any video on the home screen threw the red-box `Maximum update depth exceeded`.
- The reported frames named the store's notify loop in
  `apps/mobile/src/lib/miniPlayer/playbackRequest.ts` and `PlayerSlot` inside
  `apps/mobile/app/watch/[slug].tsx`.
- The failure was deterministic. It needed no Chromecast device and no cast session: the screen
  passes a non-null `cast` object in the idle phase, so the identity changed on the first render
  pass of every watch screen.
- Nothing in CI flagged it. The merge produced no conflict in `playbackRequest.ts`, and the full
  jest suite, typecheck, and lint all passed with the defect present.

## What Didn't Work

**Wrapping the inline `cast` literal in `useMemo`.** This is the first reflex, and it does not work
here. The memo's dependency list must include the `useCastPlayback` return value, and that value is
a new object on every render (`apps/mobile/src/hooks/useCastPlayback.ts:260-273`). The memo
therefore invalidates on every render and produces a new literal anyway.

**Comparing `a.cast.playback === b.cast.playback` in the store.** This fails for the same reason.
The nested `playback` object is the unstable value, not a stable one that the outer literal wraps.

Only the LEAF values inside `playback` are stable, which the source confirms:

- `state` is the `useReducer` state object (`useCastPlayback.ts:71-74`). React returns the same
  reference until a dispatch produces a new one.
- `deviceName`, `devicesAvailable`, `remotePlayerState`, `position`, and `duration` are primitives
  or `null` (`useCastPlayback.ts:262-266`).
- `load`, `play`, `pause`, `seekTo`, `end`, and `reset` are `useCallback` values
  (`useCastPlayback.ts:207, 234, 238, 242, 251, 256`).

The screen's own three siblings are stable for the same class of reason: `resolveCastMediaAt` and
`handleCastPress` are `useCallback` (`apps/mobile/app/watch/[slug].tsx:340, 356`), and
`castRecovery` is `useMemo` (`apps/mobile/app/watch/[slug].tsx:397`).

**Memoizing the whole return value inside `useCastPlayback`.** This would work, but it moves the
guarantee to the wrong place. The store would still trust identity, and every future member added to
`CastPlayback` would have to join a dependency list correctly or reopen the same loop. The store is
the module that depends on the property, so the store should verify it. This is a judgement made in
this session, not a measured result.

**The risk assessment made during the merge, which dismissed this exact hazard.** The reasoning
recorded at merge time was: `PlayerSlot` builds the request from PROPS, so a store-triggered
re-render reuses the same `cast` object and `samePlaybackRequest` returns `true`. That statement is
true for `PlayerSlot`'s own re-render. It is false as soon as the PARENT re-renders, and the parent
re-renders on every store notification because it subscribes to the same store. The dismissal
reasoned about the CONSUMER of the value and never checked whether the PRODUCER was stable.

That dismissal also reached the tree as a doc comment, and the first fix left it behind. The
comparator was corrected while `apps/mobile/src/lib/miniPlayer/playbackRequest.ts` still declared:

```ts
/** The surface's cast wiring, forwarded to the chrome. Identity-compared:
 *  `useCastPlayback` rebuilds it every render, which is how the chrome
 *  follows the receiver's ~1Hz position. */
cast: VideoPlayerCast | null
```

That comment did not merely go stale — it restated the false premise that produced the bug, on the
very line the fix corrected. A reader trusting it would learn that identity comparison is right here
and that rebuilding every render is the mechanism the chrome depends on. It was corrected in place
when this learning was compounded; the comment now names the field-wise rule and the loop it avoids.

**Removing the comparison instead of fixing it.** This is a bug in the opposite direction, and it is
measured below.

## Solution

Compare the cast wiring field-wise, mirroring the `sameSession` helper that already exists in the
same file for the same reason. Fixed on the feat-367 branch `worktree-mobile-pip-mini-player-v2`
(PR #1962), unmerged as of this writing.

Before:

```ts
    a.castActive === b.castActive &&
    a.cast === b.cast &&
```

After (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:216-239, 257-258`):

```ts
/**
 * Field-wise, like `sameSession` and for the same reason: the screen builds its
 * cast wiring as an inline literal AND subscribes to this store, so comparing
 * identity is a render loop — notify, re-render, new literal, notify. Every
 * leaf below is a primitive or a `useCallback`/reducer value that only changes
 * when the receiver does, which is exactly when the chrome must follow.
 */
function sameCast(
  a: VideoPlayerCast | null,
  b: VideoPlayerCast | null,
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return (
    a.onCastPress === b.onCastPress &&
    a.resolveMediaAt === b.resolveMediaAt &&
    a.recovery === b.recovery &&
    a.playback.state === b.playback.state &&
    a.playback.deviceName === b.playback.deviceName &&
    a.playback.devicesAvailable === b.playback.devicesAvailable &&
    a.playback.remotePlayerState === b.playback.remotePlayerState &&
    a.playback.position === b.playback.position &&
    a.playback.duration === b.playback.duration &&
    a.playback.load === b.playback.load &&
    a.playback.play === b.playback.play &&
    a.playback.pause === b.playback.pause &&
    a.playback.seekTo === b.playback.seekTo &&
    a.playback.end === b.playback.end &&
    a.playback.reset === b.playback.reset
  )
}
```

The precedent it copies sits 25 lines below it in the same file
(`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:264-277`). `session` is the request's OTHER
inline literal, published by the same screen (`apps/mobile/app/watch/[slug].tsx:660-667`):

```ts
function sameSession(
  a: PlaybackSessionDescriptor | null,
  b: PlaybackSessionDescriptor | null,
): boolean {
  if (a == null || b == null) return a === b
  return (
    a.videoId === b.videoId &&
    a.videoSlug === b.videoSlug &&
    a.title === b.title &&
    a.posterUrl === b.posterUrl &&
    a.languageSlug === b.languageSlug &&
    a.originPattern === b.originPattern
  )
}
```

`castActive` stays a plain value comparison (`playbackRequest.ts:257`). It is a boolean, and it is
the one cast fact the session-admission predicate reads
(`playbackRequest.ts:146`, called at `playbackRequest.ts:465`).

**Verification.**

The regression test counts store NOTIFICATIONS rather than asserting on request shape. It rebuilds
the wiring with identical values and expects zero notifications
(`apps/mobile/src/lib/miniPlayer/__tests__/playbackRequest.test.ts:482-513`, "holds still when the
cast wiring is rebuilt with the same values"). A companion asserts that a genuine cast-state change
DOES republish, so the chrome cannot freeze silently instead
(`playbackRequest.test.ts:461-480`, "republishes when the cast state actually changed").

This extraction re-ran and falsified both guards against the current tree:

- The store suite passes as shipped: 42 tests, 1 suite, green.
- Restoring `a.cast === b.cast` turns the "holds still" test red with `Expected: 0, Received: 1` —
  one notification per rebuild, which is the loop.
- Replacing the comparison with a constant `true` turns the "republishes" test red — the store keeps
  the first cast object and the chrome stops following the receiver.

The session also recorded a full suite of 145 suites and 2147 tests green, a clean typecheck and
lint, and a simulator pass (tap a video, playback starts, press back, the floating mini player
appears, no red-box). This extraction did not re-run those; they are reported as the session's
result, not re-measured here.

## Why This Works

The comparator now asks the question the store actually needs answered: did anything the host or the
chrome consumes change? It no longer asks whether the caller allocated a new object, which is a
question about the caller's render count and not about playback at all.

Every leaf `sameCast` reads is stable across a render that no cast event caused. The reducer state
keeps its reference until a dispatch. The command callbacks keep theirs until the cast client
changes. The scalars are compared by value. So a render caused by scrolling, by a layout pass, or by
the store's own notification produces an equal request, `updateSlot` returns early at
`playbackRequest.ts:421`, `commit()` never runs, and no listener is notified. Step 4 of the cycle
disappears, and the cycle has no other closure.

The chrome still follows the receiver, because the receiver's ~1Hz position report changes
`a.playback.position`. That comparison fails, the store commits, the host re-renders, and the
floating window and the full chrome both show the new position. The fields that must propagate and
the fields that must not are now separated by their VALUES rather than by their allocation.

## Prevention

**An identity-compared field in a store whose notifications re-render that field's own producer is a
feedback loop.** This is the general shape. A value-equality gate in front of a store only holds if
every value it compares is stable. The moment one compared field is rebuilt on every render of a
component that the store's notification re-renders, the gate is permanently open and the store
notifies forever. Before adding a field to a store comparator, answer two questions: who BUILDS this
value, and does a notification from this store re-render that builder? If the answer to the second
question is yes, the first question decides the comparator.

**Choose the comparator from the field's producer, not from its type.** Primitives, `useReducer`
state, `useCallback` values, and `useRef` objects may be compared by identity, because a stable
producer already guarantees the property. Anything a caller can build inline needs a field-wise
comparison. `sameSession` was already in this file for exactly this reason, and the merge added a
sibling field of the same kind directly above it without copying the pattern. When a file already
contains a helper that exists to solve a hazard, treat a new field of the same shape as covered by
that precedent until proven otherwise.

**Assert at the layer the defect lives in.** Every test the merge added asserted on STORE SHAPE:
does the request carry the cast fields, does admission refuse a casting surface, does a detach
retain the right request. The defect lives in a RENDER CYCLE. No shape assertion can fail on it,
because the shape was correct the whole time — the store held exactly the right fields with exactly
the right values while it notified without end. The discriminating assertion counts notifications or
re-renders. That is why the regression test subscribes and counts rather than reading
`getSnapshot()`. Generalise it: when the defect is "this happens too often", the test must measure
FREQUENCY, and a test that measures CONTENT is structurally unable to go red.

**Guard both directions, and falsify each side once.** Dropping the comparison entirely also passes
the "no infinite loop" bar, and it is a different bug: the host would freeze on the first cast object
and the chrome would never follow the receiver. That failure is silent — no error, no red-box, just
a position display that stops moving during a cast session. A single test cannot bound a comparator
from both sides. Pair a "holds still when nothing changed" test with a "republishes when something
changed" test, and confirm that each one goes red when its own guard is removed. Both were falsified
against this tree.

**Correct the prose that carried the false premise, in the same change as the code.** Fixing the
comparator left the field's doc comment still asserting identity comparison and still reciting the
reasoning that produced the bug. A wrong comment on a corrected line is worse than no comment: it
tells the next reader that the current code is the mistake. Sweep for the prose whenever a fix
retires a mechanism — the code grep will not find it, because the words are not the symbol.

**`sameCast` is exhaustive by hand, with no type-level enforcement.** It compares all four members of
`VideoPlayerCast` (`apps/mobile/src/components/watch/VideoPlayer.tsx:94-104`) and all twelve members
of `CastPlayback` (`apps/mobile/src/hooks/useCastPlayback.ts:26-52`). That is correct today. A
thirteenth member added to `CastPlayback` will compile, typecheck, and pass every existing test while
the store silently ignores it — which is the silent-freeze direction of the bug, restricted to one
field. Consider a fixture-driven test that enumerates `Object.keys` of a complete `CastPlayback` and
asserts that changing each key in turn republishes. That test would fail the day a member is added
without a comparison.

**The same hazard class is still present in one other field, and is safe only by accident of its
producer.** `progressFeedRef` is identity-compared at `playbackRequest.ts:259`. It is safe today
because the screen builds it with `useRef` (`apps/mobile/app/watch/[slug].tsx:385`). That safety is
a property of the caller, not of the store, and a second caller that passes an inline
`{ current: … }` object reopens the identical loop. Record the requirement where the field is
declared, so a future caller reads it before publishing.

**A subscriber that derives a narrow value should not re-render on every commit.**
`usePlaybackFrameVisible` returns a boolean but subscribes to the whole snapshot object, which the
store re-allocates on every commit. That makes the closing edge of any future feedback path free.
Adding a selector or an equality function to that hook would remove the closing edge as a second,
independent control, so that a comparator mistake becomes a redundant notification rather than an
infinite loop. This is a suggestion from reading the code; it is not part of the shipped fix and it
has not been measured.

## Related Issues

- PR #1962 (`feat-367`, mobile floating mini player + native picture-in-picture) — the branch this
  fix lives on, unmerged as of this writing. PR #1953 landed the casting work being merged in.
- [`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — the META home for tests that pass for the wrong reason. This bug is a worked instance of its
  discipline seen from a new angle: the pre-fix test asserted only the positive branch (a NEW cast
  object is forwarded) and never the negative one (an UNCHANGED one is suppressed), so it passed
  identically under the broken and the correct comparator.
- [`docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md`](../logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md)
  — a different React-lifecycle hazard in the same `useSyncExternalStore` neighbourhood: a permanent
  wedge from cleanup-mutated refs, rather than a runaway notify loop.
- [`docs/solutions/design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md`](../design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md)
  — sibling state-management pitfall in the same watch-player chrome, different root cause.
