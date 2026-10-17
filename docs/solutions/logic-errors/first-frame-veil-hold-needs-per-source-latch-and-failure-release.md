---
title: "A first-frame veil hold must latch per player and source, and release on failure - expo-video sends one first frame per media item"
date: "2026-09-29"
category: "logic-errors"
module: "apps/mobile"
problem_type: "logic_error"
component: "frontend_stimulus"
severity: "medium"
symptoms:
  - "After a swipe back and then forward inside the pager rest dwell, the poster and spinner stayed about 2 s over a clip that was already playing, with sound when unmuted"
  - "The rebind took the replay-seek branch in useFeedPlayers (url === track.url, applyStart, no replaceAsync), and expo-video sent no new onFirstFrameRender for the same media item, so the feed-level firstFrames counter never passed its baseline"
  - "The active-id filter dropped the first frame that a preloaded standby drew before it became the active player"
  - "On a source error or the 12 s load timeout, the spinner and its screen-reader progressbar stayed about 2.3 s under the clip-failed message, because the veil waited for a frame that a failed load never draws"
  - "The jest suite stayed green, because the fake VideoView never emits onFirstFrameRender and 8 veilShown() assertions matched only testID explore-clip-veil while the held poster rendered explore-clip-veil-leaving"
root_cause: "logic_error"
resolution_type: "code_fix"
framework_version: "expo-video 57.0.5, expo 57.0.25, react-native 0.86.3"
related_components:
  - "apps/mobile/src/components/explore/ExploreFeed.tsx"
  - "apps/mobile/src/hooks/useFeedPlayers.ts"
  - "apps/mobile/src/hooks/useClipAutostart.ts"
  - "apps/mobile/src/lib/explore/feedState.ts"
  - "apps/mobile/src/components/explore/FeedVideoView.tsx"
  - "apps/mobile/src/components/explore/__tests__/ExploreFeed.test.tsx"
tags:
  - "mobile"
  - "expo-video"
  - "loading-veil"
  - "first-frame"
  - "explore-feed"
  - "replay-seek"
  - "gate-release"
  - "per-source-latch"
---

# A first-frame veil hold must latch per player and source, and release on failure - expo-video sends one first frame per media item

All code in this document is on PR #2451 (`feat/mobile-explore-clips-feed`,
feat-552). The PR is open and not merged as of 2026-09-29. The repo
squash-merges, so this document cites the PR and not a commit SHA. The native
`expo-video` claims cite version 57.0.5, which `apps/mobile/package.json:61`
pins as `~57.0.5`. The native files are in the installed package at
`node_modules/.pnpm/expo-video@57.0.5_*/node_modules/expo-video/`:
`FirstFrameEventGenerator.kt` under `android/src/main/java/expo/modules/video/player/`,
and `VideoView.swift` under `ios/`.

## Problem

The Explore clips feed holds a poster over a clip until the clip's view draws
its first video frame. The first version counted `onFirstFrameRender` events
at the feed level. A replay of a stream that the player already held emits no
new first frame, and a failed load draws no frame at all. In both cases the
poster and the spinner stayed on screen for up to 2 s too long.

Explore is a vertical clips feed with two feed-owned players
(`apps/mobile/src/hooks/useFeedPlayers.ts`) and a three-slot pager. A per-clip
autostart gate (`useClipAutostart`) shows a poster, a dim, and a spinner while
the clip loads. The gate is the reducer phase `veiled`
(`apps/mobile/src/lib/explore/feedState.ts:230-232`). The gate lifts on play,
on a source error, or on the 12 s timeout
(`apps/mobile/src/hooks/useAutostartPlayback.ts:22`,
`apps/mobile/src/hooks/useClipAutostart.ts:74-81`). A failure moves the phase
to `clipFailed` (`feedState.ts:234-236`).

The owner asked (2026-09-28) for a 0.3 s fade in and out, not a blink. On the
iPhone 17 simulator, the first frame arrived about 1.6 s after the gate lifted
at play. A plain fade at the gate lift showed a black band for that time. So
`ClipVeil` in `apps/mobile/src/components/explore/ExploreFeed.tsx` holds the
poster after the gate lifts. It waits for the active view's first frame, for
at most `VEIL_FRAME_WAIT_MS` (2000 ms, `ExploreFeed.tsx:732`). Then it fades
over `VEIL_FADE_MS` (300 ms, `ExploreFeed.tsx:730`), or at once under Reduce
Motion (`ExploreFeed.tsx:761`).

## Symptoms

- A swipe back and then forward inside the pager rest dwell replayed the clip
  by a seek. The poster and the spinner stayed about 2 s over a clip that
  already played, with sound when the feed was unmuted.
- A preloaded standby clip that drew its first frame before it became active
  did not release the veil. The feed dropped that frame because the standby
  was not active when the frame arrived.
- After a source error or the 12 s load timeout, the spinner and its "Loading
  video" progressbar stayed about 2.3 s under the text "This clip can't play.
  Swipe for the next one."
- The jest suite stayed green. Eight `expect(veilShown()).toBe(false)`
  assertions passed while the held poster was still on screen.

## What Didn't Work

### A feed-level count of first frames with a baseline

The first implementation of the hold kept one counter for the whole feed. It
counted a first frame only when the reporting player was the active one. The
veil captured a baseline of the count when it showed, and it left when the
count passed that baseline.

```tsx
// First frames drawn by the active view: the veil holds until one lands.
const [firstFrames, setFirstFrames] = useState(0)
const activeIdRef = useRef(state.active)
activeIdRef.current = state.active
const handleFirstFrame = useCallback((player: PlayerId) => {
  if (activeIdRef.current === player) setFirstFrames((n) => n + 1)
}, [])

// In ClipVeil, after the gate lifts:
if (firstFrames > frameBaseline.current) {
  leave()
  return () => fadeOut?.stop()
}
const wait = setTimeout(leave, VEIL_FRAME_WAIT_MS)
```

This design has three wrong assumptions:

1. **"Each start of playback emits a first frame."** This is false. `expo-video`
   emits `onFirstFrameRender` once for each media item on a view (see the
   table below). A replay of the stream that a player already holds is a seek,
   and it emits nothing.
2. **"A first frame counts only if the view is active when it arrives."** This
   is false. The standby player preloads its clip, so its view can draw the
   first frame before it becomes active. The active-id filter dropped that
   frame, and no second frame came.
3. **"Each drop of the gate is the play release."** This is false. A source
   error and the timeout also drop the gate. A failed load draws no frame, so
   the veil always waited the full cap.

The review run (ce-code-review, run 20260928-135135-45157488) reported
assumption 1 as finding #4 and assumption 3 as finding #5. Both were P2, and
the independent validator confirmed both on the code.

### How the replay reaches the seek branch

`useFeedPlayers.syncSource` binds a slot to a player only when the pager is at
rest (`useFeedPlayers.ts:430`). The rest dwell is
`EXPLORE_PAGER_REST_DWELL_MS` = 200 ms
(`apps/mobile/src/components/explore/ExplorePager.tsx:24`). A swipe back and
then forward inside the dwell gives the clip back to a player that still holds
its stream. `syncSource` then takes the replay branch, which seeks and does not
call `replaceAsync` (`useFeedPlayers.ts:441-445`):

```ts
if (url === track.url) {
  // The player already holds this stream: a replay seeks, with no reload.
  if (track.sourceLoaded) applyStart(id)
  return
}
setSource(id, url, active)
```

The review found other paths to the same branch. They are a swipe back before
the standby gate opens, and a return from a tab blur inside the release grace
after the load finished during the blur. Two consecutive clips of one video in
one-player mode also reach it.

### The native event contract

| Platform | When the event fires                                                                                                                                                            | What resets it                                                                                                                | A seek on the same item                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android  | `onRenderedFirstFrame` with a valid surface layout, but only when no event was sent for the current media item or the current view (`FirstFrameEventGenerator.kt:54-60, 79-86`) | `onMediaItemTransition` (`FirstFrameEventGenerator.kt:62-65`) and `onTargetViewChanged` (`FirstFrameEventGenerator.kt:73-75`) | No event. ExoPlayer calls `onRenderedFirstFrame` again after a seek, and the generator suppresses it "to match the behavior across platforms" (`FirstFrameEventGenerator.kt:77-78`).                                  |
| iOS      | A KVO change of `playerViewController.isReadyForDisplay` to `true` (`VideoView.swift:182-188`)                                                                                  | No latch in `expo-video`. The value goes false and true again when AVKit displays a new item.                                 | No event. Per the session's validator, a seek on the item that is already displayed does not change `isReadyForDisplay`. This is AVKit behavior, not `expo-video` source, so this document did not verify it in code. |

The Android generator also resets on a change of target view. Explore keeps
one view for each player (`key={player}`, `ExploreFeed.tsx:536`), so a replay
does not change the view, and no second event comes.

### Why the jest suite did not see it

- The shared `expo-video` mock renders `VideoView` as `jest.fn(() => null)`
  (`apps/mobile/src/test-utils/expoVideoMock.ts:278`). It never calls
  `onFirstFrameRender` by itself. Only an explicit test helper sends a first
  frame (`firstFrame`, `ExploreFeed.test.tsx:673-681`). So no test could see a
  path where the real event does not come.
- The presence helper `veilShown()` matched only testID `explore-clip-veil`
  (`ExploreFeed.test.tsx:656-661`). The held poster renders testID
  `explore-clip-veil-leaving` (`ExploreFeed.tsx:816`). So eight existing swipe
  assertions of `expect(veilShown()).toBe(false)` passed during the hold.
- No test covered the failure release of the new component.

## Solution

The fix keeps one "a frame is drawn" flag for each player. The first-frame
event sets the flag. A new source clears it. The veil reads the flag of the
active player, and it has a second release for failure.

**1. Per-player state in `ExploreFeed`** (`ExploreFeed.tsx:248-258`):

```tsx
// Per player: its view has drawn a frame of the source it holds. A replay of
// the same stream is a seek, and expo-video sends no new first frame for it.
const [framed, setFramed] = useState<Record<PlayerId, boolean>>({
  a: false,
  b: false,
})
const markFramed = useCallback((player: PlayerId, value: boolean) => {
  setFramed((last) =>
    last[player] === value ? last : { ...last, [player]: value },
  )
}, [])
```

**2. Set on the event, clear on a new source.** Each view reports for its own
player (`ExploreFeed.tsx:544`). The `onSourceSet` callback now names the player
(`useFeedPlayers.ts:89`). `setSource` calls it right after `replaceAsync` with
a new media item (`useFeedPlayers.ts:379-386`). The feed clears the flag there
(`ExploreFeed.tsx:266-270`):

```tsx
const { players, activePlayer, seekActive } = useFeedPlayers({
  // ...
  onSourceSet: (_token, player) => {
    telemetry.firstMotionStage("sourceSet")
    markFramed(player, false)
  },
})
```

Each mounted view in `renderUnderlay` sets the flag of its own player:

```tsx
<FeedVideoLayer
  player={players[player]}
  onFirstFrameRender={() => markFramed(player, true)}
/>
```

The replay branch does not call `setSource`, so the flag stays `true` for a
stream that the view already drew.

**3. The veil reads the active player's flag and the failure flag**
(`ExploreFeed.tsx:553-558`):

```tsx
<ClipVeil
  visible={veil.veilVisible}
  failed={veil.failed}
  uri={veil.image?.uri ?? null}
  framed={framed[state.active]}
  // ...
/>
```

**4. The leave effect has two immediate releases and one cap**
(`ExploreFeed.tsx:785-807`):

```tsx
if (framed || failed) {
  leave()
  return () => fadeOut?.stop()
}
const wait = setTimeout(leave, VEIL_FRAME_WAIT_MS)
```

**5. The spinner does not render during a failure** (`ExploreFeed.tsx:822`).
So screen readers do not announce "Loading video" under the failure text.

The fix removed the counter, the baseline ref, and the active-id filter.

## Why This Works

The fact that the veil needs is a property of a (player, source) pair: "this
player's view has drawn a frame of the source it holds now." The native event
only marks the moment when that property becomes true. A counter or a baseline
records event arrivals, not the property. So it misses every case where the
property is already true and no new event comes.

Each case now has a correct result:

- **Replay by seek.** No new source, so `markFramed(player, false)` does not
  run. The flag is still `true`, and the veil leaves at once.
- **New source on a view that drew the old one.** `setSource` clears the flag
  when it calls `replaceAsync`. The gate lifts only after that load and a play.
  So the veil waits for the new frame.
- **Preloaded standby.** The standby's frame sets its own key. When the standby
  becomes active, `framed[state.active]` reads that key, and the veil leaves at
  once. The standby frame does not release the active veil early, because the
  veil reads only the active key (test at `ExploreFeed.test.tsx:1014`).
- **Failure.** `failed` comes from the reducer phase `clipFailed`
  (`useClipAutostart.ts:96`). It releases the veil without a frame. A failure
  also clears the track's URL (`fail` calls `dropSource`,
  `useFeedPlayers.ts:310-319, 343`). So a retry goes through `setSource`, and
  the retry clears the flag.
- **Any other missed event.** `VEIL_FRAME_WAIT_MS` stays as the unconditional
  release.

### Evidence

- New tests in `apps/mobile/src/components/explore/__tests__/ExploreFeed.test.tsx`:
  - "lifts the veil at once over a stream its view already drew" (line 1023).
    It asserts that `loads(B)` stays one URL (no reload) and that the veil is
    gone within `VEIL_FADE_MS`.
  - "holds the veil for a new source even when the view drew the old one"
    (line 1043). This is one-player mode, where the flag must reset.
  - "drops the spinner and the veil at once when the clip fails (R40)" (line 1064) and "... when the load times out (R40)" (line 1077). Each asserts no
    `explore-clip-spinner-region` and no leaving veil after `VEIL_FADE_MS`.
- Falsification: the session made four deliberate breaks, one at a time. They
  were no release on a drawn frame, no reset on a new source, a failure that
  waits for a frame, and a spinner that stays on failure. Each break turned its
  matching tests red. Each file came back from a copy.
- Full mobile suite at the fix: 328 suites and 5,731 tests pass, with `tsc`
  and `eslint` clean. After a later merge of `main`: 389 suites and 7,045
  tests.
- Device check on the iPhone 17 simulator and a Galaxy S20. The back-then-forward
  swipe took the replay-seek path (log `replay-seek a loaded=true`). The veil
  left 160-190 ms after the seek with `framed=true`. The old code held it 2 s.
- Failure check on both devices. A local fake-admin proxy rewrote each `hls`
  URL in `ExploreClipCandidates` responses to a 404. The veil left at the error
  with `failed=true`. A 10 fps recording showed no spinner in the first failure
  frame and the poster gone in about 0.3 s.

## Prevention

### Model a once-per-item native event as per-owner state, not as a count

When a UI waits for a native event that fires once for each item, do these
steps:

1. Read the native source for the event before you design on it.
2. Write down when the event fires and what resets it.
3. List each action that reuses the item without a reset: a seek, a replay, a
   loop, a view reattach, or a preload.
4. Keep a boolean for each owner of the item (here, each player).
5. Set the boolean in the event handler.
6. Clear the boolean at the one action that starts a new item (here,
   `setSource` after `replaceAsync`).
7. Read the boolean of the owner that the UI shows now.

Do not count events. Do not capture a baseline when the UI shows. A baseline
assumes that a new event will come after each show, and a reuse action breaks
that assumption. The same trap appears in
`docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md`.

### Give each exit of the gate its own release

A hold that waits for "the first frame after play" must know why the gate
dropped. List each exit of the gate: play, source error, timeout, and blur.
Give each exit that draws no frame a release that does not wait for the event.
Keep a time cap as the last release. This extends
`docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`.

A hold after the gate is also a layer that outlives the gate predicate. The
veil has `pointerEvents="none"` (`ExploreFeed.tsx:813`), so it does not block a
touch. But it can still cover the failure text or a playing clip for up to the
cap. See
`docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md`
for that residual risk.

### Test the paths where the event does not come

- A fake native view does not emit events by itself. Send the event from the
  test with an explicit helper, and add tests where the event never comes: a
  replay by seek, a failure, and a frame from a view that is not active.
- When one layer renders under two testIDs by phase, assert both phases. A
  presence helper that matches only one testID passes while the other phase is
  on screen:

```tsx
await swipePrevious()
await swipeNext()
await advance(REST)
expect(loads(B)).toEqual([feedUrl(2)]) // No reload: the replay-seek branch ran.
await advance(VEIL_FADE_MS + 50)
expect(veilShown()).toBe(false)
expect(leavingVeil()).toBe(false) // The held poster is gone too.
```

- Break each release on purpose, one at a time, and make sure that a test goes
  red. Restore the file from a copy, not from `git checkout`, so that
  uncommitted work stays.

This is one more case of the mocked-versus-real gap in
`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.
The test double emitted the event only when a test asked. So the suite could
not model the real rule "once for each media item on a view."

### Verify on a device with tagged logs

1. Add temporary `console.log` lines with one tag (this session used `[r3]`).
2. Put them at the replay-seek branch, `setSource`, `onFirstFrameRender`, and
   the veil show and leave. Log `framed` and `failed`.
3. Read the lines from the Metro log.
4. Remove the lines before the commit.
5. Search the bundle again to make sure that no tagged line stays.

For the failure path, use a local copy of the fake-admin smoke proxy
(`docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`).
Make it rewrite each `hls` URL to a URL that returns 404.

Caution: the broken URL also goes into the stored ready clip. AsyncStorage key
`explore-ready-clip` (`apps/mobile/src/lib/explore/pool.ts:20`) keeps the
stream URL. So the first clip of the next launch fails until a good clip
replaces it. Clear that key after the test.

### Residual risks

- The show path calls `layer.stopAnimation()` and then `layer.setValue(1)`
  (`ExploreFeed.tsx:773-774`). A native-driven animation can report its stop
  one frame late and overwrite that reset (see
  `docs/solutions/ui-bugs/native-animated-stop-report-overwrites-immediate-setvalue.md`).
  This fix did not change that path, and the risk is still open.
- `markFramed(player, false)` runs when `replaceAsync` is called, not when the
  new item is displayed. A first-frame event of the old item could be in the
  JS queue at that moment and set the flag again. This session did not see it
  on a device, and no test covers it.

## Related Issues

- PR #2451 (open as of 2026-09-29): the Explore clips feed (feat-552), which
  contains this fix.
- `docs/solutions/ui-bugs/tv-home-backdrop-crossfade-aba-stall-20260615.md`:
  the closest prior art. A fade gated on a load event needs an
  already-satisfied fast path. This document is the `expo-video` instance, and
  it adds that the already-satisfied fact must be cleared for a new source.
- `docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md`:
  the parent law for the failure release.
- `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`:
  the veil gate's three releases, which a hold after the gate must repeat.
- `docs/solutions/logic-errors/measure-cache-keyed-wider-than-view-key-misses-onlayout-on-fabric.md`:
  the same event-grain rule for `onLayout` on Fabric.
- `docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md`:
  paired state must share the lifetime of the fact it stands for.
- `docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md`:
  `replaceAsync` settles when the source is set, not loaded. This is why the
  flag resets at the `replaceAsync` call and the first frame sets it later.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`:
  the META law for why the jest suite missed both defects.
- `docs/solutions/ui-bugs/tv-showcase-dual-player-crossfade-dub-hop-blanking.md`:
  the same verification method with temporary tagged logs, on a dual-player
  surface.
