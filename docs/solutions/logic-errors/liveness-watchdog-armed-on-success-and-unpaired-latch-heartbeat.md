---
title: "Liveness watchdog armed on the success of the fault it detects — then an 'unreachable' branch made it worse"
date: 2026-07-16
category: logic-errors
module: apps/tv
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "The 12s load-timeout watchdog could not arm on a cold launch: it was gated on shouldPlay, which requires videoReady — a latch set ONLY by a successful expo-video readyToPlay status — so a source that never starts never reports ready and the exact fault the watchdog exists to catch went undetected"
  - "The disarmed window coincided exactly with the fault: after a player error, videoReady stayed false until some later source succeeded, which in the failing scenario never happens"
  - "The fix for that traded the bug to the other axis — a session-lifetime confirmation ref (confirmedTokenRef) outlived an arm-lifetime heartbeat ref (lastAdvanceAtRef), which is nulled on every watchdog re-arm"
  - "A background-to-foreground resume re-arms the watchdog WITHOUT bumping the excerpt token, landing in (confirmed=true, heartbeat=null) — a state the verdict function's own comment called unreachable but which was reachable by construction, skipping BOTH the load and stall branches"
  - "In that state the clock ticked at 1Hz forever, structurally unable to return anything but ok — strictly worse than the original bug, which caught that same resume at 6s"
  - "Both defects were invisible to a fully green suite (1011 tests / 78 suites) and to mutation testing; only adversarial re-reading of the code found them"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - testing_framework
tags:
  - "liveness-guard"
  - "watchdog"
  - "self-referential-gating"
  - "unreachable-branch"
  - "ref-lifetime-pairing"
  - "react-native-tv"
  - "expo-video"
  - "green-while-red"
---

# Liveness watchdog armed on the success of the fault it detects

## Problem

`apps/tv`'s showcase reel plays video excerpts unattended on an office TV for hours. Its
degradation ladder only reacts to a _reported_ failure, but the two faults office wifi actually
produces report nothing: a source that never starts, and one that starts and then freezes.
`reelWatchdog.ts` exists to turn that silence into a reported failure — a 12s budget from asking
for playback to a first frame (`REEL_LOAD_DEADLINE_MS`, `reelWatchdog.ts:10`) and a 6s budget of
playhead silence once playing (`REEL_STALL_DEADLINE_MS`, `reelWatchdog.ts:17`).

The guard shipped broken in both directions:

- **It could not arm for the fault it existed to catch.** The load deadline was gated on a signal
  only a _successful_ load produces.
- **The fix for that introduced a state it could not fire from at all** — armed, ticking, and
  structurally unable to return anything but `"ok"` — by softening a branch on the reasoning that
  its state was "unreachable" without checking whether it was.

PR #1586 (`feat/tv-showcase-mode`) — open and unmerged as of writing. The sequence is four commits:
`74e2d8dd` (original watchdog), `3f06b76e` (seeds the stall clock at confirmation), `695e7039`
(arms on intent; also hardens the branch that half 2 then exposes), `feb10e29` (pairs the latch to
the heartbeat). These SHAs are pre-merge and local to that branch; this repo squash-merges, so they
will not exist on `main`. They are provenance for the sequence, not lookup keys — use the PR.

## Symptoms

A screen that looks fine to code. No error, no exception, no failed assertion — and an unattended
TV holding one frame forever, which is the whole scenario the reel exists to survive. Nothing in
logs, because the guard whose job was to log it never fired.

## What Didn't Work

This is the useful part. Everything below passed while the guard was broken.

1. **The full unit suite was green through every defect** — 1011 tests, 78 suites. The pure
   classifier had complete branch coverage while its wiring was dead.
2. **Extracting a pure, testable module did not help; it relocated the risk.** `apps/tv` installs
   no renderer (`react-test-renderer` and `@testing-library/react-native` both absent), so
   components cannot be render-tested. The pure modules are unit-testable _because_ the wiring is
   not — and the wiring is where a guard is armed. Both P0s lived in that seam.
3. **Every test supplies the arm input as a literal.** The steady-state fixture
   (`reelWatchdog.test.ts:9-14`) sets it true and each case perturbs one axis away from it; a
   couple of cases pass false. Either way the value is written by the test, never derived from the
   gate — so no test could observe that the caller never passed it true when it mattered. A pure
   function's inputs are exactly the assumptions its tests stop checking.
4. **A test actively pinned the bug as intended behaviour.** `74e2d8dd` shipped _"calls it stalled,
   not a load timeout, when the player claimed to play but never moved"_ — encoding the
   false-positive as a contract, so the suite defended it.
5. **Mutation testing passed and proved nothing.** Reverting each fix killed exactly one test. That
   demonstrates the tests pin the fixes; it says nothing about whether the fixes are _correct_.
   Reverting a fix and watching a test fail cannot detect a fix that is wrong in a direction no
   test represents.
6. **One unchecked assumption was the entire root cause of half 2.** The author reasoned "this
   state is unreachable" and softened a verdict on that basis without reading the lifetimes of the
   two refs involved.

What _did_ find it: independent agents instructed to **refute** each fix, each from a different
angle, reading the actual code. Five converged on the same trace.

One caveat on that, learned while writing this doc. The same adversarial reading was then applied
to this document's own prose and found four false claims in it — including an earlier draft of this
very section, which asserted that a prior learning had foreshadowed this bug and gone unapplied.
Neither half was true: the cited prevention concerns a different hazard, and it _was_ applied, in
this same file. Adversarial reading of code does not automatically extend to the prose written
about that code, and a tidy narrative is exactly where an invented claim hides.

## Solution

### Half 1 — arm on intent, not on readiness (`695e7039`)

`shouldPlay` requires `videoReady`, a latch initialised `false` (`ReelPlayer.tsx:106`), set only on
`status === "readyToPlay"` (`ReelPlayer.tsx:215`). A source that never starts never reports ready.

The load path does not depend on the view being mounted: the player is created once with a null
source (`ReelPlayer.tsx:128-133`) and each excerpt is handed to it by a `replaceAsync` effect
(`ReelPlayer.tsx:169-209`, whose only guard is a stream-identity check at `:173`) that is **not**
gated on `shouldMountVideo` — only the `VideoView` is (`:423`). The load can fail entirely before
anything is on screen.

The fix adds a distinct gate output (`reelPlayerGate.ts:71`) and arms the watchdog on it:

```ts
// Deliberately NOT gated on videoReady — see the type's doc.
playIntended: active && hasStream && screenFocused && appForeground,
```

The test that keeps the two signals from ever collapsing back together:

```ts
it("still intends playback for a source that has not reported itself ready", () => {
  const gate = computeReelPlayerGate({ ...playing, videoReady: false })
  expect(gate.shouldPlay).toBe(false)
  expect(gate.playIntended).toBe(true)
})
```

### Half 2 — pair the latch with its heartbeat (`feb10e29`)

`confirmedTokenRef` holds a source identity for the whole component lifetime
(`ReelPlayer.tsx:142`), written only inside `playingChange` (`ReelPlayer.tsx:251`); nothing clears
it — not pause, not background, not error. `lastAdvanceAtRef` is nulled on every re-arm
(`ReelPlayer.tsx:351`). A resume flips `appForeground` (`ReelPlayer.tsx:89-94`) and re-arms
**without** bumping `excerptToken` — the reel's state machine has no AppState awareness.

So `confirmed` stayed true while its heartbeat was nulled: `confirmed` skipped the load branch,
`null` skipped the stall branch, and neither deadline applied.

The fix scopes a second latch to the arm, set with the heartbeat and cleared with it, and requires
both halves at the call site (`ReelPlayer.tsx:365-368`):

```ts
// Both halves: this arm saw a frame, AND it was this excerpt's. Either alone
// lets a stale confirmation hand a cold re-buffer the tighter stall budget.
confirmed:
  armConfirmedRef.current && confirmedTokenRef.current === excerptToken,
```

The branch now states the invariant it rests on rather than asserting an outcome
(`reelWatchdog.ts:58-61`):

```ts
// Unreachable: confirmation and the heartbeat are seeded together and cleared
// together, so confirmed implies a heartbeat. If this ever fires, that pairing broke —
// and the caller has a player it believes is playing that no deadline is watching.
if (msSincePlayheadAdvance == null) return "ok"
```

## Why This Works

**Half 1.** Intent is what the reel _wants_; readiness is what the player _achieved_. A guard
measures the gap between them, so only the first can arm it.

The bug has a precise origin worth knowing: `videoReady` was _designed_ as a mount gate. It is a
latch — deliberately not cleared on transient `idle` blips — because clearing it unmounted the
`VideoView` and forced a full HLS re-init (see
`docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md`, the doc that
introduced this composition). Those latch semantics are correct for mounting and exactly wrong for
arming. The sibling gate `videoBackdropGate.ts` has no readiness term at all
(`shouldPlay: active && !overlayVisible && appGate`), so the flaw was not inherited — it was born
the moment a gate built for one purpose was reused as the arming condition for another.

**Half 2.** A latch that lives for the session and a heartbeat that lives for one arm cannot be
read as a single condition. The fix is literally that the two clears are now adjacent lines. A
failed resume falls to the 12s load budget, which is the correct one: a cold re-buffer _is_ a load,
and the 6s stall budget would clip a legitimately slow one.

## Prevention

**A. Arm a liveness guard on intent, never on the success of the thing it guards.** Ask of every
guard: _what sets the condition that arms this clock, and can the fault I am catching prevent that
condition from ever being set?_ If yes, the guard is decorative. Read the derivation to a leaf —
`shouldPlay` looks innocent; `videoReady` three levels down is the whole bug.

**B. Never reuse a gate across purposes without re-deriving it.** A mount gate and an arm gate
answer different questions. Shared derivation is a coincidence, not a contract.

**C. If you soften a branch because a state is "unreachable", make it unreachable by construction
and state the invariant AT the branch.** A comment asserting unreachability is not a substitute for
a shared lifetime. If the invariant is real, say what it rests on and what it means if it fires.

**D. Paired state must share a lifetime.** If two pieces of state are consumed as one fact, clear
them in the same place. Same family as
`docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — a ref's
lifetime is part of its contract, and mixing two lifetimes in one condition is where the hole
opens.

**E. A guard fails in two directions; check both.** A false-fire is loud — something gets skipped,
someone notices. A never-fire is silent, and silence is what a working guard looks like. Ask of
every fix to a guard whether it _moved_ the failure rather than removing it. That is exactly what
`695e7039` did.

**F. Fixing a self-referential-gating bug can introduce another in the fix's own bookkeeping.**
Fix 1 was a review-driven correction of the original; fix 2 was a review-driven correction of fix

1. The same class of gap recurred one commit later, inside the fix. Trace _every_ re-arm path, not
   only the one that motivated the fix.

**G. Full branch coverage on a pure module whose caller has none is a signal, not a reassurance.**
When you extract logic to make it testable, the seam you created is now the untested part — and for
a guard, the seam is where it arms.

## Related Issues

- `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — sibling
  ref-lifetime learning (feat-241). Different trigger (StrictMode remount vs AppState resume), same
  family.
- `docs/solutions/ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md` — adjacent
  AppState-lifecycle learning, different mechanism. Its Prevention #4 concerns reading a stale
  pre-`await` snapshot; that rule is applied in this same file (`ReelPlayer.tsx:204`) and is not
  what broke here.
- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — introduced the
  `videoReady` latch this watchdog inherited, and the composition where readiness gates the
  `VideoView`. Note the reel's own novelty was folding `videoReady` into the _pure_ gate, where it
  then fed `shouldPlay`; the backdrop composes it at the JSX boundary instead.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — mocked
  tests prove branch shape, not production contract. This is that law applied to a guard's
  _arming_: complete coverage of a pure classifier says nothing about whether its caller can ever
  supply the input that matters.
- `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md` — the same
  meta-pattern one step later in the lifecycle, in `apps/mobile`. Here the watchdog's _arming_
  condition was suppressed by the fault; there a gate's _release_ conditions were incomplete
  ("success OR error" missing "neither"). That fix follows this doc's lesson rather than repeating
  it: its timeout arms unconditionally on the waiting state, not on a readiness signal.
- Code: `apps/tv/src/components/showcaseMode/reelWatchdog.ts`, `reelPlayerGate.ts`,
  `ReelPlayer.tsx`.
