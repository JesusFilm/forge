---
title: "TV /watch overlay plays on black at 0:00 — backdrop VideoView starved the fullscreen player's decoder"
date: 2026-06-11
last_updated: 2026-06-16
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
root_cause: resource_contention
resolution_type: code_fix
severity: high
symptoms:
  - "Pressing Play on the /watch/[slug] details page opens a black fullscreen player that never advances (stuck at 0:00, duration loads e.g. 5:53)"
  - "Play button briefly flips to the pause icon (playingChange -> true) then reverts to play (playingChange -> false) — playback starts then immediately stalls"
  - "Manifest loads fine (duration is known) but no frames decode and currentTime never advances"
  - "Only happens from the watch details page (which renders a VideoBackdrop); experience-card playback with no backdrop works"
tags:
  - tv
  - tvos
  - react-native-tvos
  - expo-video
  - hls
  - avplayer
  - decoder-contention
  - single-decoder-rule
  - video-backdrop
  - player-lifecycle
---

# TV /watch overlay plays on black at 0:00 — backdrop VideoView starved the fullscreen player's decoder

## Problem

On `apps/tv` `/watch/[slug]`, pressing Play opened the fullscreen `VideoPlayer` overlay on a black screen that never played. The HLS manifest loaded (the duration showed, e.g. `5:53`), and `playingChange` fired `true` for an instant (the control flipped to the pause icon) before flipping back to `false` (play icon) — playback started, then immediately stalled. `currentTime` stayed at `0:00`. The fix the user "remembered" (the frozen-`creationSource` + `replaceAsync` pattern, and `play()` in a `useEffect` not the setup callback) was already in place; this was a different, newer cause.

## Symptoms

- Fullscreen player: black, play icon, `0:00 / 5:53`, controls visible. Reproduced every time from the watch page on Apple TV 4K simulator (tvOS 26.4).
- `playingChange` genuinely toggled true→false (so it was a _stall after start_, not a bad URL — the manifest + duration loaded).
- Did NOT reproduce from experience-card playback (Home/SDUI screens), which has no concurrent backdrop player.

## Root cause

The watch page renders a **second** `expo-video` player — `VideoBackdrop` — a full-screen muted cinematic loop pointed at the same `activeVariant.hls`. The fullscreen overlay (`_layout.tsx` → `VideoPlayerOverlay` → `VideoPlayer`) mounts as a **sibling of the Stack**, so the watch page (and its backdrop player) stays mounted _behind_ it. Two players coexist.

The backdrop already implemented the "single-decoder rule (R6)": when `overlayVisible` it called `player.pause()`. **But `pause()` is not enough on tvOS** — a mounted `<VideoView>` keeps its `AVPlayerLayer`/decode slot allocated even while its player is paused. tvOS caps how many AVPlayer render pipelines can be live at full-screen resolution; with the backdrop's `VideoView` still mounted, the overlay player couldn't acquire a decoder, so it started then stalled on black.

Why it regressed now: the 2026-06-09 seamless-loop fix (`expo-video-backdrop-seamless-loop-20260609.md`) **latched `videoReady`** (reset only on `error`, never on the transient `idle` blip) to stop the `VideoView` unmounting at the loop seam. A side effect: the backdrop `VideoView` _also_ no longer unmounts when the overlay opens — so the decode slot is never released. Before the latch, an `idle`/status blip would have torn the `VideoView` down incidentally; the latch made the leak permanent. Typecheck/eslint/jest can't see a stalled decoder, so CI was green.

## What didn't work / wasn't the cause

- **Frozen `creationSource` + `replaceAsync`** — already correct; the overlay source is stable and valid (duration loaded). Not a source-recreate bug.
- **`play()` in the setup callback** — already correctly deferred to a `useEffect` with a 300ms retry. Not the cause.
- **On-mount `replaceAsync` swap** (dub-switch effect) — ruled out: `handlePlay` opens with `activeVariant.hls`, identical to `sessionActiveHls`, so the effect early-returns. No swap on mount.
- **`player.pause()` on the backdrop (R6)** — necessary but insufficient. Pause stops _decoding_ but does not _release the layer/slot_.

## Solution

Unmount the backdrop `<VideoView>` (don't just pause its player) while the overlay is visible — add `!overlayVisible` to the render gate in `apps/tv/src/components/watch/VideoBackdrop.tsx`:

```tsx
// before
{hasValidStream && videoReady ? (
  <Animated.View ...><VideoView player={player} .../></Animated.View>
) : null}

// after — detach the VideoView so tvOS frees the decode slot for the overlay
{hasValidStream && videoReady && !overlayVisible ? (
  <Animated.View ...><VideoView player={player} .../></Animated.View>
) : null}
```

The backdrop sits entirely behind the overlay (zIndex 1000) while it plays, so unmounting it is visually free. `videoReady` stays latched true through the overlay session, so on close the `VideoView` remounts immediately with no poster re-fade, and the existing R6 effect (`player.play()` on `!overlayVisible`) resumes the backdrop.

## Why this works

`pause()` halts decoding but leaves the `AVPlayerLayer` attached, which still counts against tvOS's simultaneous-render budget. Removing the `<VideoView>` from the tree detaches the layer and frees the slot, so the fullscreen overlay player can acquire a decoder and play. The overlay's existing 300ms autoplay retry covers any brief race between the backdrop layer tearing down and the overlay player's first `play()`.

## Verification (simulator — CI can't see a stalled frame)

1. EXPO_TV Metro on 8082; Apple TV 4K sim booted.
2. Deep-link / navigate to a `/watch` page, press Play.
3. **Before:** black, play icon, `0:00`, never advances.
4. **After:** real frames decode, pause icon shows, `currentTime` advances, controls auto-hide on the 3s timer. Dismiss → backdrop resumes on the watch page (advancing, no black flash). Repeatable across open/close/reopen.

Drive via `idb ui key 40` (Select) / `41` (Menu) + `xcrun simctl io <udid> screenshot`.

## Dev-loop look-alike: the Fast-Refresh zombie (don't debug the wrong bug)

The SAME symptom (plays for a tick -> stalls black at 0:00, pause icon flips back to play) reappears in **dev** whenever Metro Fast Refresh applies an edit to any player file (`VideoPlayer.tsx`, `VideoBackdrop.tsx`, `SubtitleOverlay.tsx`, `useSessionPlayback.ts`) while the app is running — including indirect writes like the pre-commit prettier hook rewriting staged files AFTER you finished testing. The hot reload tears through the mounted player tree and orphans the old native `AVPlayer`, which keeps its decode slot until process death; the next play wedges exactly like the production bug above. It hit three separate times during this branch's development.

**Rule: after any edit lands in a player file, cold-relaunch the app before judging playback** (`xcrun simctl terminate <udid> org.jesusfilm.forgetv` + relaunch + reconnect Metro). _(2026-07-17: TV builds after PR #1590 use bundle id `org.jesusfilm.forgewatch` — target that id; only pre-#1590 installed clients keep `forgetv`.)_ If a cold launch plays and a hot-reloaded session doesn't, it's the zombie — not a code regression. Verify fixes only from cold launches.

**It also presents as an _immediate_ terminal error, not only the plays-a-tick stall.** On a fresh details-page play (2026-06-16, branch `feat/tv-home-search-polish`) the zombie surfaced as the `VideoPlayer` error overlay — **"Playback failed — press Back to exit", duration `--:--`, expo-video `statusChange` status `"error"`, no manifest load** — because the new player never acquired a decoder at all. Same root cause, blunter symptom; recognise this screen as the zombie too. (It recurs across branches, not just the one it was first found on.)

**When the starvation fix above is already in place, don't re-chase it — or the URL, or secrets — go straight to the cold-launch test.** This recurrence wasted time ruling out, in order: decoder starvation (the `!overlayVisible` gate was present and working), an expired/signed Mux URL (it's a public `stream.mux.com/<id>.m3u8`, passes `validateStreamingUrl`, plays fine), and missing `.env.local`/secrets (byte-identical config between the failing and working runs — config can't be the cause when the _only_ variable that changed was Fast Refresh). All three are dead ends the moment a cold launch plays the same build.

**Positive "is it actually playing?" probe** — confirm the decode pipeline independent of the JS UI by streaming the device log while you press Play:

```bash
xcrun simctl spawn <udid> log stream --predicate \
  'process == "JesusFilmWatch" OR senderImagePath CONTAINS "CoreMedia"'
```

Continuous `subaq_enqueueAQBufferIntoAudioQueue` (audio enqueue) + `LayerSync` lines with zero decode-error lines = the pipeline is healthy and advancing (a cold launch shows the playhead climb 0:33 → end). Silence on those lines, or explicit decode-failure lines, = a real problem. The `err 61` / `ECONNREFUSED` TCP lines in the same log are the dev client polling a dead Metro — not video, which is remote HTTPS.

## Prevention

- **On tvOS, free a concurrent player by UNMOUNTING its `VideoView`, not just `pause()`.** When a fullscreen player must coexist with a background/inline player (hero, backdrop, card autoplay), gate the background `VideoView`'s mount on `!overlayVisible`. Pause alone leaves the decode slot allocated.
- **Re-audit any latched-readiness gate for "what else used to unmount this."** Latching `videoReady` to survive a loop seam also removed the incidental unmount-on-overlay-open. When you stop a component from unmounting, list every prior reason it unmounted and confirm each is handled explicitly.
- **Same-class risk:** `VideoHeroRenderer` (inline experience-card autoplay) pauses on `playerState.isVisible` but does not unmount its `VideoView`. It hasn't surfaced (smaller/inline decode load), but if a full-screen inline hero ever stalls the overlay, apply the same `!overlayVisible` mount gate.

## Related Issues

- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — introduced the `videoReady` latch whose side effect caused this. The latch is still correct; this adds the missing overlay-open unmount gate.
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` — baseline tvOS autoplay (play() in useEffect) + the "AVPlayer instance-cap bounds" note this bug is a concrete instance of.
- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — "AVPlayer instance-cap" + pause-vs-unmount tradeoff for the focus-driven hero crossfade.
- Memory: `expo-video-usevideoplayer-recreates-on-source` — the _other_ (source-recreate) expo-video footgun; distinct from this decoder-slot one.
