---
title: "TV showcase language hop cut to black, then to a frozen still, before landing on a true dual-player crossfade"
date: "2026-07-21"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Every ~10s language-dub hop in the TV showcase centerpiece dimmed the whole reel to black — the KTD-5 hop-dip mask was timed over a surface that was already blank"
  - "After a first dual-player fix landed, EVERY hop boundary still fell back to the poster-masked swap instead of flipping — video cut to a film-still poster and resumed a beat later, at every single hop"
  - "The poster fallback was visually indistinguishable from a genuine footage frame in screenshots, so burst-capture verification could not tell 'flipped cleanly' from 'silently fell back' until Metro-log markers were added"
  - "After the render-timing fix, the revealed incoming view sat parked/frozen on its preloaded frame for 0.5-1.5s before motion resumed — read as a frozen thumbnail card, not a hop"
  - "The crossfade sometimes re-showed the last 2-3 frames the outgoing cover had already played, because the standby was parked exactly on the boundary instead of past it"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - "apps/tv/src/lib/showcaseMode/hopHandoff.ts"
  - "apps/tv/src/components/showcaseMode/useHopHandoff.ts"
  - "apps/tv/src/components/showcaseMode/ReelPlayer.tsx"
  - "apps/tv/src/components/showcaseMode/ShowcaseScreen.tsx"
  - expo-video
tags:
  - tv
  - tvos
  - showcase-mode
  - expo-video
  - avplayer
  - hls
  - dual-player
  - crossfade
  - replaceasync
  - hop-handoff
---

# TV showcase language hop cut to black, then to a frozen still, before landing on a true dual-player crossfade

## Problem

The TV showcase's centerpiece plays one video's footage while hopping between audio dubs roughly every 10 seconds (same footage, different HLS URL per dub). Every hop was user-visibly broken: the picture cut away and came back a moment later, first to black, then — after a first fix attempt — to the excerpt's poster still. Branch `fix/tv-showcase-seamless-hop`, PR #1632 (open, unmerged as of writing). Module `apps/tv` (React Native TV, Expo SDK 54, `expo-video@3.0.16` for HLS playback).

## Symptoms

- Dip-mask over a single player: the hop "dip" dimmed an already-blank surface — viewers saw a cut to black for the length of the HLS re-init.
- First dual-player attempt: a 100% silent fallback rate — every hop cut to the poster still and resumed a beat later.
- The poster fallback was indistinguishable from real footage in screenshots; only log markers exposed that the flip path never ran.
- After the render-timing fix: the flip worked but visibly froze on the incoming player's parked frame before motion resumed.
- Final polish: the crossfade occasionally repeated the last 2-3 frames the outgoing cover had already played.

## What Didn't Work

**0. Years of masking on a single player, without ever trying a second one.** (session history) Prior sessions never attempted a second player — it was ruled out up front on a paraphrased belief ("two-player crossfade hits a known tvOS memory leak") inherited from the original showcase plan's KTD-2/KTD-3, and every seam artifact was instead patched surface-by-surface on the single-player dip: the frame-hold dip itself, the covered-swap delay, the dropped-seek self-heal, per-overlay crossfades. Each patch was locally correct; none could fix the structural gap.

**1. A dip/mask timed over a single player around `replaceAsync`.** Both of `expo-video`'s `replaceCurrentItem` overloads (sync at lines 196-231, async at 236-268 of the package's iOS VideoPlayer source, v3.0.16) funnel into a single `AVPlayer.replaceCurrentItem(with:)` call with the new item — and AVFoundation blanks the player's surface from that call until the incoming item renders its first frame, which on a hop spans the whole HLS re-init plus the mid-video seek that follows (target windows can start well past 0:00; observed as the cut-to-black on tvOS). No opacity mask timed over a _single_ player can hide a gap the platform makes structural; the shipped "hop dip" was dimming an already-black surface, which is exactly what viewers reported as a cut to black.

**2. Publishing the hop's stream from a `useEffect`, one commit after the reducer advanced.** The first dual-player attempt (the opening commit of PR #1632) built two long-lived players and a standby-preload machine, but the shell (`ShowcaseScreen.tsx`) published `hopStream` from an effect while `preloadStream` was a plain render memo. `preloadStream` therefore advanced to the _next_ hop's target one commit before `hopStream` caught up. In that single-commit window the standby's preload-decision logic read `(new preloadStream, old hopStream)`, concluded its already-`ready` standby was now stale for the (still-old) target, and tore it down — so by the time `hopStream` caught up on the next commit, there was no ready standby left and every boundary silently took the poster fallback. Because the poster art is a film still of the scene, this looked identical to a correctly-preloaded frame in a screenshot; burst-capture verification alone could not distinguish "flipped" from "silently degraded." Only temporary `console.log` markers at the flip/reveal/preload-ready call sites (see Prevention) exposed that the flip path was _never_ taken — zero flips across the whole run.

**3. Revealing the incoming view immediately at flip time.** Once the render-timing bug was fixed and the reservation actually survived to the boundary, the flip swapped views straight away — but the incoming player was still settling its seek and spinning up its buffer, so it sat visibly parked on its preloaded frame for 0.5-1.5s. This read as a "thumbnail card" popping in, not a hop.

## Solution

**Two long-lived players, created once, roles alternate per hop (not per-mount).** `ReelPlayer.tsx:160-161`:

```ts
const playerA = useVideoPlayer(null, configurePlayer)
const playerB = useVideoPlayer(null, configurePlayer)
```

`useHopHandoff` (`apps/tv/src/components/showcaseMode/useHopHandoff.ts`) tracks which one is `live` vs `standby` via a `liveKey` state flag (`"a" | "b"`, line 105) that flips on every hop — the players themselves are never recreated, only their roles swap. This is a deliberate supersession of the single-player KTD-2 law: the leak trigger there is player/view _churn_, not a second fixed instance (documented in `apps/tv/CLAUDE.md`, "Common Pitfalls").

**Fix for cause #2 — derive the hop stream and its preload target at render, from the same state, in the same commit.** `ShowcaseScreen.tsx:438-455`:

```ts
// KTD-5: the current hop's stream and the NEXT hop's preload derive at RENDER from
// the same reducer state as the token, so all three advance in one commit. An
// effect-published stream lagged a commit behind, and in that gap the reel's
// preload machine read (new preload, old stream) and clobbered the ready standby —
// every boundary fell back to the poster.
const hopStream = useMemo(() => {
  const hop = state.hop
  if (hop == null) return null
  const current = hop.hops[hop.index]
  return current == null ? null : hopToStream(current)
}, [state.hop])
const preloadStream = useMemo(() => {
  const hop = state.hop
  if (hop == null) return null
  const next = hop.hops[hop.index + 1]
  return next == null ? null : hopToStream(next)
}, [state.hop])
```

Both are `useMemo`s off the identical `state.hop`, so React guarantees they change in the same commit as `state.excerptToken`. The preload-decision table that consumes them, `resolvePreloadAction` (`apps/tv/src/lib/showcaseMode/hopHandoff.ts:101-115`), never again observes a `(new preload, old target)` pair.

**Fix for cause #3 — reveal only on confirmed motion, never at the flip.** `flip()` (`useHopHandoff.ts:302-340`) swaps which player is "live" synchronously, but the crossfade does not run yet:

```ts
pendingRetiredRef.current = live
setPendingReveal({ token })
setLiveKey((key) => (key === "a" ? "b" : "a"))
```

The outgoing player is deliberately left **rolling**, not paused, at its window end when a flip is armed — `ReelPlayer.tsx:553-561`:

```ts
// A ready flip leaves the player ROLLING past its end: the same footage
// continues, and it is the visible motion cover until the incoming confirms.
if (!nextFlipArmedRef.current) {
  try {
    live.pause()
  } ...
}
```

Its audio is already faded to 0 by the ordinary window-end fade-out, so it's a silent, still-moving cover for the same footage the incoming player is about to show. The crossfade effect (`useHopHandoff.ts:395-447`) only fires `Animated.timing(viewBOpacity, ...)` once `confirmedToken === excerptToken` — i.e., once the incoming player has actually reported `playingChange`. The result: the audience only ever sees motion crossfade into motion, never a frozen or blank frame.

**Confirmation robustness — poll backs up the event, and re-issues a possibly-swallowed `play()`.** The flip's `play()` call is issued one commit before the new live player's `playingChange` listener re-attaches (the listener effect keys off `live`, which just changed), so the event can be lost. `useHopHandoff.ts:371-387`:

```ts
useEffect(() => {
  if (pendingReveal == null) return
  const startedAt = Date.now()
  const timer = setInterval(() => {
    let playing = false
    try {
      playing = live.playing
      if (!playing && Date.now() - startedAt >= REVEAL_REPLAY_AFTER_MS) {
        if (shouldPlayRef.current) live.play()
      }
    } catch {
      return // Released; the watchdog owns recovery.
    }
    if (playing) confirmPlayback()
  }, REVEAL_POLL_MS)
  return () => clearInterval(timer)
}, [pendingReveal, live, confirmPlayback, shouldPlayRef])
```

`REVEAL_POLL_MS = 150`, `REVEAL_REPLAY_AFTER_MS = 600` (`useHopHandoff.ts:40,43`). The 600ms grace before re-issuing `play()` guards against tvOS swallowing a `play()` queued directly behind a fresh seek — the same platform quirk documented separately for the dropped-seek pitfall (`docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md`), hit here at a different choke point.

**Readiness requires `status === "readyToPlay"`, not just position/buffer.** Position and buffer reads can look plausible off an item still wedged in `"loading"`, and a flip armed on such an item plays nothing. `hopHandoff.ts:139-169` (`preloadPollVerdict`):

```ts
if (!landed) return "reseek"
if (!args.statusReady) return "wait"
const buffered = ... args.bufferedPosition >= args.startSeconds + PRELOAD_MIN_BUFFER_AHEAD_SECONDS
if (buffered || args.elapsedMs >= PRELOAD_BUFFER_GRACE_MS) return "ready"
return "wait"
```

A wedged load ages out at `PRELOAD_DEADLINE_MS = 8000` (`hopHandoff.ts:16`), also reused as the `Promise.race` bound on the standby's `replaceAsync` (`useHopHandoff.ts:211-219`) — past that, the boundary takes the deliberate poster fallback instead of arming a dead flip.

**AVPlayer barely buffers a paused item — explicit forward-buffer target on the standby.** `useHopHandoff.ts:203-205`, `PRELOAD_FORWARD_BUFFER_SECONDS = 15` (line 53):

```ts
standby.bufferOptions = {
  preferredForwardBufferDuration: PRELOAD_FORWARD_BUFFER_SECONDS,
}
```

Ordinary (non-hop) loads restore the captured library default (`ReelPlayer.tsx:406-408`, `defaultBufferOptionsRef`), so the 15s cap stays scoped to hop preloads only.

**Park the standby past the boundary, not on it.** The outgoing cover rolls a beat past the boundary before the reveal fires; a standby parked exactly on the boundary re-shows frames the cover already played. `hopHandoff.ts:49-54`, `HANDOFF_RESUME_NUDGE_SECONDS = 0.125` (~3 frames at the film's 24fps), applied at the initial seek, the dropped-seek heal, and the readiness verdict alike — `useHopHandoff.ts:193-196`:

```ts
const parkSeconds =
  validPreload.window.startSeconds + HANDOFF_RESUME_NUDGE_SECONDS
```

**Misc hardening from review:** silence the outgoing player on a failure-driven flip so old-language audio can't bleed under the incoming fade-in (`ReelPlayer.tsx:377-389`, `setVolumeOn(live, 0)` ahead of `flip(...)`); the reveal-retire timer is ref-held and cleared on unmount only, never on cleanup, because the owning effect re-runs the instant `pendingReveal` clears and a cleanup-cleared timer would die before firing (`useHopHandoff.ts:128-131`, `412-427`); a dead flip's cover is abandoned at the very next boundary that skips it, via `abandonDeadFlip()` (`useHopHandoff.ts:342-354`, called from `ReelPlayer.tsx:391`), so a flip that never confirms can't leave the retired player rolling until the _next_ confirmation; and the align-seek is skipped within `ALIGNMENT_TOLERANCE_SECONDS = 0.75` (`hopHandoff.ts:34-40`, `alignmentSeekTarget` at `177-202`) because a fresh zero-tolerance seek (`ref.seek(to:, toleranceBefore: .zero, toleranceAfter: .zero)`, line 55 of the same package source) flushes the decoder on the critical path, and a sub-second offset is invisible under the motion crossfade anyway.

## Why This Works

The dual-player architecture sidesteps cause #1 entirely: at the moment a hop boundary is reached, no `replaceAsync` is ever called on the surface the viewer is looking at — the standby already finished its `replaceAsync` and mid-video seek _before_ the boundary, while it was invisible underneath the live view (`hopEngaged` mounts both views once a preload or reservation is in play — `hopHandoff.ts:122-130`, `standbyMountEngaged`). The boundary itself is just a `viewBOpacity` fade between two views that are both already playing real footage.

Cause #2's fix works because it removes an entire class of bug rather than patching the specific race: collapsing `hopStream`, `preloadStream`, and `excerptToken` into memos off one shared piece of state (`state.hop`) makes their advance atomic _by construction_ — there is no commit at which one has moved and the other hasn't, so the preload machine can never again observe a stale-looking pairing.

Cause #3's fix (reveal-on-motion) works because it treats "the incoming player is technically live" and "the incoming player is visibly playing" as different states, and only crossfades on the second. A parked, seek-settled-but-not-yet-decoding frame is indistinguishable from a still image to the viewer; waiting for `playingChange` (backed by a poll, since the event can be lost) guarantees the reveal only ever happens once real motion is present to receive it, so the blend is always motion-into-motion.

## Prevention

- **When a visually-plausible fallback exists on the failure path, screenshots alone cannot prove the happy path ran.** The poster still and a genuine footage frame look the same in a still capture. Add short-lived, explicit log markers at each state-machine transition (flip vs. fallback, preload-ready vs. preload-failed) _before_ trusting a burst-capture verification — the markers proved the flip path had a 0% hit rate when screenshots alone could not. Once markers confirm the right path is running, burst screenshots (with consecutive-frame hashing to catch freezes) are the right tool for the remaining "is it visually smooth" question.
- **A constraint must carry its mechanism, not just its conclusion.** (session history) The single-player rule traveled through two plans as "a second player triggers a known tvOS memory leak" — a paraphrase whose evidentiary basis nobody re-examined while seam bugs were patched one surface at a time. When the mechanism was finally read (the leak trigger is player/view _churn_), the constraint dissolved and the structural fix became available. When a documented rule blocks the natural fix, go read the rule's mechanism before designing around it.
- When two pieces of derived state must advance atomically as joint inputs to a downstream decision (here: `hopStream` + `preloadStream` feeding `resolvePreloadAction`), derive both from the _same_ render off the _same_ source state — never split one into an effect and leave the other as a render memo. An effect is a commit behind; a memo is not.
- The pure decision tables (`sameHopStream`, `resolveHopSwapMode`, `resolvePreloadAction`, `preloadPollVerdict`, `alignmentSeekTarget`, `standbyMountEngaged` — all in `apps/tv/src/lib/showcaseMode/hopHandoff.ts`) are unit-tested in `apps/tv/src/lib/showcaseMode/hopHandoff.test.ts` without any render harness (house convention — `apps/tv` has none). Notably `preloadPollVerdict`'s test "never arms on an item that has not reported readyToPlay — position and buffer alone can read plausibly off a wedged load" exists specifically to pin cause-adjacent regressions from recurring.
- `apps/tv/CLAUDE.md`, "Common Pitfalls," already carries an entry describing the dual-player + reveal-on-motion architecture and its telemetry (`showcase_hop_handoff` mode=flip|fallback, `showcase_hop_preload_failed`) for future agents touching this code.

## Related Issues

- `docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md` — the tvOS dropped-seek pitfall this fix's reveal-poll re-issue and the preload park-seek heal both guard against, at two different choke points. Note: its framing of the single-player rule as current guidance predates this fix.
- `docs/solutions/integration-issues/expo-video-timeupdate-clock-drift-audio-fade-hardcut.md` — sibling pitfall in the same reel; also states the single-player rule as current guidance (predates this fix).
- `docs/solutions/ui-bugs/tv-showcase-overlay-dissolve-sequencing-beneath-live-player.md` — closest neighbor by file lineage (overlay seams over the same reel); its single-player framing predates this fix.
- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — the adjacent decode-slot physics (a paused mounted `VideoView` holds a slot); still true, and why the standby's view mounts only while hop mode needs it.
- `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — the ref-lifetime law the preload machine's StrictMode-safe cleanup follows.
- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — the native-loop HLS re-init stall that motivated manual advance; unchanged by this fix.
- `apps/tv/CLAUDE.md`, "Common Pitfalls" — the standing dual-player architecture note and the KTD-2 supersession rationale.
- PR #1632, branch `fix/tv-showcase-seamless-hop` (open, unmerged).
