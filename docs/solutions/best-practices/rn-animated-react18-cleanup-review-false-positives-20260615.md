---
title: "RN Animated cleanup and React-18 setState-after-unmount: two code-review false positives"
date: "2026-06-15"
category: best-practices
module: apps/tv
problem_type: best_practice
component: frontend_stimulus
severity: low
applies_when:
  - "Reviewing or writing RN (tvOS or mobile) useEffects that start an Animated.timing/parallel/loop"
  - "A reviewer flags a missing animation.stop() on unmount for a finite native-driver tween"
  - "A reviewer flags a missing mountedRef guard for async setState in a React 18+ codebase"
  - "Running a default-apply code review (e.g. ce-code-review) on apps/tv or apps/mobile"
related_components:
  - apps/mobile
tags:
  - react-native
  - animated
  - tvos
  - react-18
  - cleanup
  - code-review
  - false-positive
  - fabric
---

## Context

A `/ce-code-review` of `apps/tv` (React Native tvOS, Expo SDK 54, React 18,
Fabric) flagged two "unmount leak" findings that direct verification proved are
non-bugs in this stack. A reliability reviewer rated them P1/P2; reading the
actual code downgraded both to report-only. The findings recur because they
match pre-React-18 / generic-React mental models that don't hold here, and
re-raising them churns a sim-verified, delicate animation state machine.
(session history: this learning emerged from the verified review pass on
PR #1212.)

The two findings:

1. `HomeBackdrop.tsx`'s crossfade `Animated.parallel` is never `stop()`-ed on
   unmount — flagged as "in-flight callbacks fire into a dead tree."
2. `useWatchHome.ts` has no `mountedRef` guard before `setState` — flagged as
   "an Apollo promise writes state after unmount."

Both are non-bugs. The rules below say when each pattern is actually a bug and
when it is not, so reviews stop re-raising the non-bug cases.

(A sibling false-positive class — synchronous-guard "double-submit" and
ref-drift races, a JS run-to-completion concern rather than an unmount one —
lives in its own doc:
`docs/solutions/best-practices/synchronous-guard-run-to-completion-false-positive-20260615.md`.)

## Guidance

### Rule 1 — A finite native-driver tween with no JS callback needs no unmount cleanup

`Animated.timing` / `Animated.parallel` started with `useNativeDriver: true`
and **no** `.start(callback)` that calls `setState` is a pure imperative value
mutation. The `Animated.Value` it drives lives in a ref; on unmount that value
is detached and GC'd, and the native side finishes (or discards) its own
interpolation. There is no JS-side leak and no "callback into a dead tree."
Adding `const h = Animated.parallel(...); h.start(); return () => h.stop()`
buys no correctness and forces a re-read of every branch of a delicate
animation state machine.

Stop on unmount only when one of these is true:

- **The effect re-runs on a dependency** — it must cancel the prior tween
  before starting the next, or the two race on the same `Animated.Value`.
- **The animation is an infinite `Animated.loop`** — it must be stopped to free
  the native driver when the component leaves.

### Rule 2 — Under React 18, a `mountedRef` guard added solely to silence setState-after-unmount is dead code

React 18 made `setState` after unmount a **silent no-op** — the old
"Can't perform a React state update on an unmounted component" warning was
removed, and there is no leak. A `mountedRef` whose only job is to gate a
`setState` after an `await` protects nothing.

What _is_ still needed is a **stale-response guard** — but for **correctness**,
not unmount safety: when an async effect can run twice (initial load + retry),
a `requestId` counter prevents an older response from overwriting a newer one.
`useWatchHome.ts` already has this and it is correct.

**Exception — external native emitters.** A guard _is_ warranted when the
callback comes from an external native emitter that can fire after you
unsubscribe (`player.addListener`, `NativeEventEmitter`, a `setTimeout` on the
brink of unmount), because there the concern is acting on a _stale event_, not
merely the no-op `setState`. Scope the guard to that case — see
`docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md`
(Pattern 6). A finite `Animated` tween or an `await client.query()` inside a
React effect is **not** that case.

### Rule 3 — Verify the mechanism before applying a "leak/cleanup" finding

In a default-apply code review, read the cited location and its surrounding
function and comments before applying. Classify the mechanism:

- JS callback path into `setState`? → React 18 no-op; guard unnecessary.
- Native driver driving a ref-held value with no callback? → GC'd on unmount;
  no cleanup needed.
- Dep-re-running effect, or an infinite loop, or an external native emitter? →
  cleanup IS warranted; the finding is valid.

When the mechanism is a React-18 no-op or a detached-value GC, mark the finding
informational, not actionable.

## Why This Matters

The crossfade effect in `HomeBackdrop.tsx` is a multi-branch state machine
(cancel-in-flight, direct-crossfade, load-then-fade, no-artwork fast-path) that
was verified in the tvOS simulator. The finding is not wrong in principle — it
is wrong for _this_ mechanism, and applying it blindly risks regressing a
sim-verified crossfade for zero correctness gain.

The `mountedRef` pattern is a pre-React-16.8 idiom. In a React 18 codebase it
signals a misunderstanding of the platform, and a maintainer who sees it may
cargo-cult it into new components where it is even less appropriate. Naming the
correct guard (`requestId`, for correctness) keeps the intent legible.

## When to Apply

- Reviewing any `useEffect` that starts an `Animated.*` call in `apps/tv` or
  `apps/mobile`.
- Reviewing any async `useEffect` (Apollo, fetch, `setTimeout`) that calls
  `setState` on completion.
- Any default-apply code review pass — read the mechanism, not just the pattern.
- The native-driver-GC and React-18 no-op rules are platform-agnostic (tvOS and
  Android TV alike).

## Examples

### (a) Finite tween (no cleanup) vs dep-re-running tween and infinite loop (must stop)

```tsx
// NO CLEANUP NEEDED — finite native-driver parallel, values held in a ref,
// no .start(callback). Past unmount the native side drives a detached value
// and is GC'd. Adding handle.stop() is churn-only. (HomeBackdrop.tsx)
Animated.parallel([
  Animated.timing(opacities[slot], {
    toValue: 1,
    duration: CROSSFADE_MS,
    useNativeDriver: true,
  }),
  Animated.timing(opacities[other], {
    toValue: 0,
    duration: CROSSFADE_MS,
    useNativeDriver: true,
  }),
]).start()

// MUST STOP — the effect re-runs on browseState, so the prior tween must be
// cancelled before the next begins. (HomeBackdrop.tsx deepScrim)
useEffect(() => {
  const animation = Animated.timing(deepScrim, {
    toValue: deepScrimOpacity(browseState),
    duration: DEEP_SCRIM_MS,
    useNativeDriver: true,
  })
  animation.start()
  return () => animation.stop()
}, [browseState, deepScrim])

// MUST STOP — an infinite loop must free the native driver on unmount.
// (QueryDisplay.tsx caret blink)
useEffect(() => {
  const loop = Animated.loop(
    Animated.timing(blink, {
      toValue: 1,
      duration: 1100,
      useNativeDriver: true,
    }),
  )
  loop.start()
  return () => loop.stop()
}, [blink])
```

### (b) `mountedRef` unnecessary; `requestId` still required (for correctness)

```tsx
// UNNECESSARY under React 18 — setState-after-unmount is already a no-op.
const mountedRef = useRef(true)
useEffect(
  () => () => {
    mountedRef.current = false
  },
  [],
)
// ...
if (!mountedRef.current) return // dead code: React 18 no-ops setState after unmount

// REQUIRED — stale-response guard. Not for unmount; for correctness, so an
// older response can't overwrite a newer one. (useWatchHome.ts)
const requestIdRef = useRef(0)
const fetchHome = useCallback(async () => {
  const thisRequest = ++requestIdRef.current
  const result = await getApolloClient().query(/* ... */)
  if (requestIdRef.current !== thisRequest) return // ← keep
  setModel(buildModel(result.data))
}, [])
```

Fabric note: `Animated.loop(Animated.sequence(...))` runs only once on the new
architecture, and a JS-driver loop won't update native views — use a single
`Animated.loop(Animated.timing(...))` + interpolation on the native driver for
continuous animation. (auto memory [claude])

## Related

- `docs/solutions/ui-bugs/tv-home-backdrop-crossfade-aba-stall-20260615.md` —
  the same `HomeBackdrop.tsx` crossfade, different angle (why it stalls when
  `onLoad` doesn't re-fire); this doc is the counterpart on why those tweens
  need no `stop()`.
- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md`
  — Pattern 6 is the case where `isMountedRef` IS warranted (external native
  emitters); this doc draws the boundary for finite tweens and React-effect
  `setState`.
- `docs/solutions/design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md`
  — the complementary case where an in-flight Animated handle DOES need
  `.stop()` (its completion writes React state at force-reveal sites).
- `docs/solutions/best-practices/synchronous-guard-run-to-completion-false-positive-20260615.md`
  — the sibling false-positive class for synchronous-guard double-submit and
  ref-drift races (a JS run-to-completion concern, not an unmount one); same
  "verify the mechanism" discipline, different mechanism.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the same "verify the mechanism, don't accept the pattern at face value"
  discipline.
