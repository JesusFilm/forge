---
title: "An unconditional release is not enough — every layer that occludes the recovery affordance must share the gate's predicate"
date: "2026-08-20"
module: "apps/mobile"
problem_type: "logic_error"
category: "logic-errors"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "On a source error or the 12s autostart timeout the veil and spinner clear while the opaque poster stays, so the viewer sees a still frame with no spinner and no controls"
  - 'Both layers carry pointerEvents="none", so the native transport controls stay reachable by touch while being completely invisible — a blind tap is the only recovery'
  - "The poster was gated on !hasStarted and the veil on awaitingAutostart; the two agree on the happy path and diverge on exactly the two failure paths the 12s backstop exists to cover"
  - "The defect reproduces the stranding described in the documented law the same branch set out to fix, with that doc open in front of the author"
  - "The suite stayed green — no test asserted that the poster clears on the error path until the fix added one"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/hooks/useAutostartPlayback.ts"
  - "apps/mobile/app/video/[sectionKey].tsx"
  - "apps/mobile/app/collection/[sectionKey].tsx"
  - "apps/mobile/src/components/watch/PlayerLoadingVeil.tsx"
  - "apps/mobile/app/video/__tests__/sduiSectionPlayers.test.tsx"
tags:
  - "mobile"
  - "expo-video"
  - "video-player"
  - "autostart"
  - "loading-veil"
  - "gate-release"
  - "pointer-events"
  - "code-review"
---

# Two layers that hide the same control must share one predicate — a residual layer is a closed gate under a different name

All code in this document is on PR #1972
(`fix/mobile-sdui-autostart-and-hardening`). **The PR is open and not merged at
the time of writing.** Cite the PR, not a SHA: the fix landed on the branch as
`90b466ff2`, but the repo squash-merges, so that SHA will not exist on `main`.

This is a second instance of the law in
[`mobile-watch-autostart-veil-gate-missing-release-path.md`](mobile-watch-autostart-veil-gate-missing-release-path.md).
I read that law, implemented its prescription correctly, and then shipped the
same defect in a different layer of the same screen. A reviewer found it. I did
not.

## Problem

The two viewer-initiated SDUI routes did not autostart. `video/[sectionKey]`
opened on a tap-to-play poster. `collection/[sectionKey]` opened on a paused
frame under the native transport, with no poster at all. Every other player
surface in the app starts by itself behind a spinner, so the same card behaved
differently depending on the shelf the viewer came from.

The fix gave both routes the `VideoPlayer.tsx` behaviour through a new shared
hook, `apps/mobile/src/hooks/useAutostartPlayback.ts`. The hook follows the prior law
exactly. Its gate has three release operands
(`apps/mobile/src/hooks/useAutostartPlayback.ts:86-87`):

```ts
const awaitingAutostart =
  !hasStarted && sourceUrl != null && !loadFailed && !loadTimedOut
```

`hasStarted` covers success. `loadFailed` covers a reported error. `loadTimedOut`
covers everything else, and it arms unconditionally on the waiting state
(`useAutostartPlayback.ts:22`, `useAutostartPlayback.ts:91-95`):

```ts
export const AUTOSTART_VEIL_TIMEOUT_MS = 12000

useEffect(() => {
  if (!awaitingAutostart) return
  const t = setTimeout(() => setLoadTimedOut(true), AUTOSTART_VEIL_TIMEOUT_MS)
  return () => clearTimeout(t)
}, [awaitingAutostart])
```

That part is correct. The prior law says a gate that hides the only recovery
affordance needs an unconditional time-based release, because "started OR
errored" does not describe "neither". The hook has that release.

### The defect

Each route then drew **two** overlapping full-frame layers over the video view,
and gated them on **different** predicates. Before the fix,
`apps/mobile/app/video/[sectionKey].tsx` read:

```tsx
{!hasStarted && thumbnailUrl != null && (    /* the poster */
{awaitingAutostart && <PlayerLoadingVeil />} /* the veil   */
```

`!hasStarted` and `awaitingAutostart` agree on the success path. They diverge on
the two paths the timeout exists to cover. A source error sets `loadFailed`, and
the 12s backstop sets `loadTimedOut`. Either one makes `awaitingAutostart` false
while `hasStarted` is still false. The veil lifts. The poster stays.

The poster is opaque, it is `StyleSheet.absoluteFill`, and it is a sibling
rendered AFTER the `VideoView` in the same parent
(`apps/mobile/app/video/[sectionKey].tsx:151-181`,
`apps/mobile/app/collection/[sectionKey].tsx:368-396`). Both routes set
`nativeControls` (`apps/mobile/app/video/[sectionKey].tsx:154`,
`apps/mobile/app/collection/[sectionKey].tsx:371`), so the transport belongs to expo-video
and lives INSIDE that video view. Both routes also set
`surfaceType="textureView"` on Android (`apps/mobile/app/video/[sectionKey].tsx:158-160`,
`apps/mobile/app/collection/[sectionKey].tsx:375`), which is what makes the video composite
inside the RN tree so a later sibling can draw over it. The poster is that later
sibling. It covers the native controls on both platforms.

So the release paths worked, and the viewer was stranded anyway. The gate that
hid the controls was no longer `awaitingAutostart`. It was an opaque image with
no release path at all: `hasStarted` never resets by design
(`useAutostartPlayback.ts:36-38`), so on a failed load the poster is permanent
for the life of the screen.

`pointerEvents="none"` on the poster (`apps/mobile/app/video/[sectionKey].tsx:176`,
`apps/mobile/app/collection/[sectionKey].tsx:391`) is what made this survive review, mine
included. It is true, and it is not the point. It makes the controls reachable
by touch. It does not make them visible. A viewer cannot press a control that is
not there.

### Did `VideoPlayer.tsx` — the surface I copied — have the same defect?

**No. It has the same predicate divergence and it is not the same defect.** This
matters, so both halves are quoted.

The divergence is real and it is verbatim. The poster gate
(`apps/mobile/src/components/watch/VideoPlayer.tsx:675`):

```tsx
{(!hasStarted || castRemoteActive || ended) && resolvedPoster != null && (
```

The veil gate, fourteen lines later (`VideoPlayer.tsx:689`). This fence is
`text`, not `tsx`, so the formatter cannot reflow a line quoted verbatim:

```text
{awaitingAutostart && <PlayerLoadingVeil />}
```

Same two predicates, same two layers, same order. If the predicate pair were the
whole story, `/watch/[slug]` would be broken too.

It is not broken, because its recovery affordance sits ABOVE the poster instead
of below it. Three lines carry that:

1. `VideoPlayer.tsx:238` mounts the chrome on exactly the paths that lift the
   veil: `const chromeMounted = controls.mounted && !awaitingAutostart`.
   `controls.mounted` starts true
   (`apps/mobile/src/hooks/useControlsVisibility.ts:41`), so an error or a
   timeout mounts the chrome in the same commit that clears the veil.
2. The chrome renders LATER in the same `StyleSheet.absoluteFill` parent that
   holds the poster — the scrim at `VideoPlayer.tsx:755` and `PlayerControls` at
   `VideoPlayer.tsx:790`, against the poster at `VideoPlayer.tsx:675`. No layer
   in that parent sets `zIndex`, so paint order is tree order. The controls draw
   over the residual poster.
3. The host's video view sets `nativeControls={false}`
   (`apps/mobile/src/components/watch/PlaybackHost.tsx:1100`). There is no native
   transport inside the video view for a React sibling to cover.

`VideoPlayer` also keeps the route buttons live underneath the veil
(`VideoPlayer.tsx:730-737`), and its poster layer is deliberately shared with two
other states — a cast session and ended playback — which is why its predicate is
`(!hasStarted || castRemoteActive || ended)` rather than the gate.

The deciding variable is not the predicate pair. It is where the recovery
affordance sits relative to the residual layer. I copied the predicates and did
not copy the layering that made them safe. **The new SDUI routes are the only
place this defect existed. Do not flag `/watch/[slug]`.**

## Symptoms

- A viewer whose SDUI stream failed saw a still poster frame, no spinner, and no
  controls. The screen looked like a paused video that would not respond.
- The same state appeared 12 seconds into any load that neither started nor
  errored, which is the exact case `AUTOSTART_VEIL_TIMEOUT_MS` exists to rescue.
- The controls stayed reachable by touch, so a blind press could still work.
  Nothing on screen told the viewer they were there.
- Nothing threw and nothing logged. The player reported an error or it reported
  nothing, and both produced the same silent screen.
- The Jest suite was green, and not for want of an error-path test. One already
  ran the exact divergence path and passed, because it asserted the veil layer
  and never the poster.

## What Didn't Work

Each item below looked like cover. None of it was.

- **"I followed the documented law."** I did, for the layer the law named. The
  law is written about a veil. The defect was in a poster the law never
  mentions. A law stated in terms of one named component does not transfer
  itself to a second component with the same job.
- **"`pointerEvents="none"` keeps the controls reachable."** True, and
  irrelevant. Reachable is not visible. This phrase sat in the code comment I
  wrote, and it read as a safety argument. It was a description of a different
  property.
- **"The veil is the gate, so the veil is the thing to get right."** The gate is
  whatever hides the controls. Two layers hid the controls. Only one of them was
  treated as a gate.
- **"`hasStarted` is the natural predicate for a poster."** It is the natural
  predicate for a poster on a surface where the chrome draws above it. On these
  routes the chrome draws below it, so `hasStarted` names a state with no exit.
- **"The copied surface proves the pattern is safe."** `VideoPlayer.tsx` gates
  its poster on `!hasStarted` and is correct. The property that makes it correct
  is its layer order (`VideoPlayer.tsx:238`, `:675`, `:755`, `:790`), not its
  predicate. I carried the visible half of the pattern across and left the
  load-bearing half behind.
- **"The existing render tests cover the autostart path."** This is the sharpest
  one, because the tests covered more than "the happy path" and were blind
  anyway. Two tests existed before the fix. The success-path test
  (`apps/mobile/app/video/__tests__/sduiSectionPlayers.test.tsx:294-305`) stays
  GREEN with the defect restored, which is unremarkable — success is the one
  path where the two predicates agree.

  The instructive one is the second. A test already ran the exact divergence
  path, and it passed with the defect present. Its pre-fix body asserted only
  that the veil's label was gone and that the player was not playing; the poster
  was never queried, because no helper could see it. Worse, its pre-fix name was
  `"drops the veil when the source fails, so the transport is reachable"` — the
  `pointerEvents` fallacy from the bullet above, encoded in a test title and
  passing as evidence. A test on the right path that asserts the wrong layer is
  not weaker coverage than no test; it is actively worse, because it is cited as
  coverage. The fix renamed it and gave it a `posterShown` helper.

## Solution

One change, applied identically to both routes on PR #1972, commit `90b466ff2`.

### Both layers now read one predicate

`apps/mobile/app/video/[sectionKey].tsx:167-181`:

```tsx
{/* Poster and veil share ONE predicate. Gating the poster on
    `!hasStarted` instead would leave it covering the native
    controls after a failed or timed-out load — visible controls
    are the recovery affordance, so both must clear together. */}
{awaitingAutostart && thumbnailUrl != null && (
  <Image … pointerEvents="none" recyclingKey={`sdui-video-poster-${…}`} />
)}
{awaitingAutostart && <PlayerLoadingVeil />}
```

`apps/mobile/app/collection/[sectionKey].tsx:382-396` carries the same comment and the same
pair. Neither route destructures `hasStarted` any more
(`apps/mobile/app/video/[sectionKey].tsx:133`, `apps/mobile/app/collection/[sectionKey].tsx:169`).

### A regression test that fails on the error path

`apps/mobile/app/video/__tests__/sduiSectionPlayers.test.tsx:310-321` runs against BOTH
screens through `describe.each`:

```tsx
it("clears the POSTER too when the source fails, not just the veil", async () => {
  const renderer = await renderScreen(Screen, section)
  expect(posterShown(renderer)).toBe(true)

  await act(async () => {
    video.__player.__emit("statusChange", { status: "error" })
  })

  expect(labelled(renderer, "Loading video")).toBe(false)
  expect(posterShown(renderer)).toBe(false)
  expect(video.__player.playing).toBe(false)
})
```

`posterShown` keys on the `recyclingKey` prefix `sdui-…-poster-`
(`sduiSectionPlayers.test.tsx:196-205`), which the playlist thumbnails
(`coll-thumb-*`) cannot match by accident. `labelled(renderer, "Loading video")`
reads the veil's own accessibility label
(`apps/mobile/src/components/watch/PlayerLoadingVeil.tsx:16-17`). The test
therefore distinguishes the two layers, which is the whole requirement.

### Three false prose claims corrected in the same commit

Review found three statements that were wrong, and all three were mine:

- The hook's header said both routes opened on a tap-to-play poster. Only
  `video/[sectionKey]` did; `collection/[sectionKey]` had no poster at all
  (`useAutostartPlayback.ts:9-15`).
- `apps/mobile/CLAUDE.md` said "if you add a third player surface" when three
  already existed. It now says fourth (`apps/mobile/CLAUDE.md:409`).
- `apps/mobile/CLAUDE.md:416-431` gained the rule itself, stated as a rule
  rather than as a description of the current code.

## Why This Works

`awaitingAutostart` is the only predicate in the screen whose false value is
guaranteed by a timer. `hasStarted` has no such guarantee, and by design it never
resets (`useAutostartPlayback.ts:36-38`). Binding every layer that can hide the
controls to the guaranteed predicate makes the unconditional release apply to all
of them at once. The 12s backstop now protects what it was written to protect.

The three release operands do not change. What changes is their reach. Before,
the backstop released one of two blocking layers, so its guarantee was void. A
release path that clears only some of the obstructions is not a release path.

The falsification is empirical, not asserted. I restored `!hasStarted` on
`apps/mobile/app/video/[sectionKey].tsx` alone and re-ran the suite:

```
✕ video/[sectionKey] › clears the POSTER too when the source fails, not just the veil
✓ collection/[sectionKey] › clears the POSTER too when the source fails, not just the veil
Tests: 1 failed, 9 passed, 10 total
```

Two facts in that output matter. Exactly the reverted route went red, so the test
discriminates per screen rather than passing on a shared mock. And
`autostarts once the source is applied, then clears poster and veil`
(`sduiSectionPlayers.test.tsx:294-305`) stayed GREEN with the defect present.
That is the direct measurement of why the original suite could not catch this:
the happy path is the one path where the two predicates cannot disagree. The tree
was restored with `git checkout` afterwards.

The timeout path has coverage at the hook layer only
(`apps/mobile/src/hooks/__tests__/useAutostartPlayback.test.tsx:220-234`), where
no poster exists. That is acceptable because both layers now read the one
predicate the hook returns, so the screen-level error test pins the coupling and
the hook test pins the release. If the layers ever diverge again, that argument
dies with them.

## Prevention

**The law: a gate is not a component, it is a predicate. Every layer that can
hide the recovery affordance must read the same predicate. Count the layers, not
the gates.**

The prior law (`mobile-watch-autostart-veil-gate-missing-release-path.md`) asks
you to enumerate the paths that fail to OPEN a gate. This one asks you to
enumerate the layers that stay CLOSED when it opens. They are the same failure
seen from two sides, and a fix for the first does not imply a fix for the second.

1. **Inventory the layers over the recovery affordance before you inventory the
   predicates.** Read the render tree and list every full-frame sibling with a
   background, an image, or a non-zero opacity. Two layers were enough here. Ask
   of each one: which predicate removes it, and does that predicate have an
   unconditional release?
2. **Where the recovery affordance is native, treat every later sibling as
   opaque.** `nativeControls` puts the transport inside the video view. Any RN
   sibling rendered after that view covers it, and on Android
   `surfaceType="textureView"` is what makes that true rather than the reverse. A
   surface with `nativeControls={false}` and React-rendered chrome has the
   opposite z-order and the opposite risk. Check which one you are on before you
   copy a predicate.
3. **When you port a gate between surfaces, port the reason, not the
   expression.** `VideoPlayer.tsx` gates its poster on
   `(!hasStarted || castRemoteActive || ended)` correctly
   BECAUSE its chrome renders at `:755` and `:790`, after the poster at `:675`.
   Name the property that makes the source correct, then check that the property
   holds at the destination. If it does not hold, the expression is wrong even
   though it is identical. This is the same discipline the repo applies to
   cross-app discriminator literals: re-derive from the destination, never copy
   from the source.
4. **Do not accept `pointerEvents="none"` as evidence about visibility.** It is
   evidence about hit testing and nothing else. Where a comment offers it as a
   safety argument for a covering layer, the comment is the bug marker. Both
   pre-fix comments said "Both layers pass touches through, so the native
   controls stay reachable". Both were true, and both were beside the point.
5. **Write the discriminating test on a DIVERGENCE path, and prove that it
   discriminates.** A success-path assertion over two predicates that agree on
   success is vacuous with respect to their coupling. Restore the defect, run the
   suite, and record which test goes red and which stays green. If the happy-path
   test also goes red, you have not isolated the property.
6. **Leave no unused predicate on the shared hook's surface.**
   `useAutostartPlayback` still returns `hasStarted`
   (`useAutostartPlayback.ts:97`), and no production caller reads it
   (`apps/mobile/app/video/[sectionKey].tsx:133`, `apps/mobile/app/collection/[sectionKey].tsx:169`). It
   remains available to any future route that wants a poster gate, which is the
   exact re-introduction surface this fix closed. Either narrow the return type
   or state at the declaration that the field is not a render gate.
7. **A law you followed is not a law you applied everywhere it reaches.** I read
   the prior doc, implemented its prescription, and shipped its defect in the
   next layer down in the same commit. When you cite a law in a PR description,
   re-read its statement against the WHOLE diff, not against the line that made
   you cite it.

## Related

- [Autostart veil gate strands viewers on a permanent spinner](mobile-watch-autostart-veil-gate-missing-release-path.md)
  — the direct parent. That doc gives the gate three release operands; this one
  finds that a second layer ignored all three. Read them together: the release
  set and the layer set are two different completeness questions about one gate.
- [Liveness watchdog armed on the success of the fault it detects](liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md)
  — the same family. There the backstop never armed; here it armed, fired, and
  cleared only one of two obstructions.
- [Per-message boundary limits for media surfaces](../best-practices/per-message-boundary-limits-for-media-surfaces.md)
  — the sibling reasoning about what a containment mechanism actually reaches.
- [Mocked-shape versus real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — the META home. The cross-app discriminator entry in that table is the closest
  match: a correct expression carried across a boundary whose destination
  contract differs. Here the differing contract is the render tree's paint order.
