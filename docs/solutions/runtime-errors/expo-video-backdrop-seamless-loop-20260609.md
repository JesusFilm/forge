---
title: "expo-video hero backdrop pauses on black at the loop point — latch videoReady + manual playToEnd replay"
date: 2026-06-09
category: runtime-errors
module: apps/tv
problem_type: runtime_error
component: frontend_stimulus
severity: medium
symptoms:
  - "Muted full-screen hero backdrop video pauses on a black screen at the end of the clip, looping back only after a multi-second delay"
  - "The loop restart visibly re-runs the intro (poster-hold ~500ms then a ~500ms fade-in) instead of continuing seamlessly"
  - "player.loop = true does not fix it — the native HLS seek-to-start re-buffers slowly"
  - "A transient idle status at the loop seam sets videoReady=false, unmounting the gated VideoView and forcing a full HLS re-init"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - testing_framework
tags:
  - tv
  - tvos
  - react-native-tvos
  - expo-video
  - hls
  - video-loop
  - player-lifecycle
---

# expo-video hero backdrop pauses on black at the loop point — latch videoReady + manual playToEnd replay

## Problem

The TV `/watch/[slug]` hero backdrop video (`apps/tv/src/components/watch/VideoBackdrop.tsx`, full-screen muted autoplay, expo-video on react-native-tvos) hung on a black screen at the end of each playthrough and only restarted after a multi-second delay, breaking the "always-playing cinematic backdrop" feel.

## Symptoms

- At the end of the clip the backdrop went black and froze for several seconds before the next loop began.
- The restart visibly re-ran the intro sequence (poster held ~500ms, then a ~500ms fade-in) instead of seamlessly continuing.
- Reproduced on Apple TV 4K simulator (tvOS 26.4) with a ~64-70s clip; frame-sampling across the loop point showed a run of identical (frozen/black) frames at the seam.

## What Didn't Work

- **Native `player.loop = true` (the original).** It does loop, but on tvOS the native loop re-buffers the HLS seek-to-start slowly. Worse, the loop seam emits a transient `idle`/`error` status blip, and the `statusChange` handler reset `videoReady = false` on it — which unmounted the gated `VideoView`, forcing a full HLS re-init plus a re-run of the 500ms poster-hold + 500ms fade-in. That re-init + fade is the multi-second black pause.
- **Relying on the native loop alone, even after latching `videoReady`.** Not chosen — it still leans on the slow native re-buffer for the restart. An explicit `playToEnd` -> `replay()` with `loop = false` gives a deterministic, immediate in-player restart instead.

The original `loop = true` + unmount-on-blip code shipped because the looping behaviour was never exercised during the page's design restyle: the hero plays in the background and the loop point only surfaces ~64s into the clip, well past the time spent visually verifying the UI layout (session history). Typecheck/eslint/jest cannot see a frozen frame, so the regression was invisible to CI.

## Solution

Three coordinated changes in `VideoBackdrop.tsx`: turn off the native loop, drive the loop manually with `replay()`, and latch the readiness gate so loop-seam status blips can't unmount the player.

`loop` flag (the `useVideoPlayer` factory) — before/after:

```ts
// before
const player = useVideoPlayer(creationSource, (p) => {
  p.muted = true
  p.loop = true
})

// after — looped manually via the playToEnd listener below
const player = useVideoPlayer(creationSource, (p) => {
  p.muted = true
  p.loop = false
})
```

`statusChange` handler — before/after:

```ts
// before
if (status === "readyToPlay") setVideoReady(true)
else if (status === "error" || status === "idle") setVideoReady(false)

// after — latch ready; reset ONLY on a genuine error, never on idle
if (status === "readyToPlay") setVideoReady(true)
else if (status === "error") setVideoReady(false)
```

New `playToEnd` -> `replay()` listener (the manual loop), with an overlay-pause race guard:

```ts
const sub = player.addListener("playToEnd", () => {
  // overlay (fullscreen player) opened at the loop seam -> don't resume a
  // second decoder (single-decoder rule, R6)
  if (overlayVisibleRef.current) return
  try {
    player.replay()
  } catch {
    // native player already released; benign
  }
})
```

`overlayVisibleRef` is a `useRef` mirroring the `overlayVisible` prop, updated inside the overlay-pause effect so the `playToEnd` callback reads the live value without re-registering the listener on every toggle. The frozen `creationSource` + `replaceAsync` dub-swap pattern (inherited from the mobile video-detail work) is preserved untouched.

## Why This Works

Two compounding causes, each addressed:

1. **Slow native re-buffer.** `loop = true` re-buffers the HLS seek-to-start on tvOS, which is slow. `replay()` is an in-player seek-to-0 + resume on the native module (verified: the iOS and Android native modules both call `play()` after the seek) — deterministic and immediate.
2. **The player was unmounting at the seam.** The `VideoView` is gated on `videoReady`. The loop seam emits a brief `idle` (and sometimes `error`) status; the old handler reset `videoReady = false` on either, unmounting the `VideoView` and forcing a full HLS re-initialization plus a re-run of the poster-hold -> fade sequence. That re-init + fade was the long black pause.

The fix latches `videoReady`: once `readyToPlay`, it stays true through the `idle` blip, so the player never unmounts and `replay()` is just a fast in-player seek rather than a cold HLS init. The **idle-vs-error distinction** is the key: a loop-seam blip is always `idle` (a momentary not-ready state), never a real failure, so dropping the `idle` reset is safe; a genuine `error` (expired HLS token, CDN outage, decode failure) is _not_ a transient seam blip, so keeping `error -> setVideoReady(false)` preserves the poster fallback for permanent failures. The overlay guard prevents a queued `playToEnd` from resuming the backdrop right after the overlay-pause effect paused it, upholding the single-decoder rule.

Because the source is a frozen `creationSource` (the player is created once per mount and only ever swapped via `replaceAsync`, never re-created), latching `videoReady` is safe — the player was never going to restart on its own anyway (session history).

## Prevention

For a seamless looping HLS backdrop in expo-video on tvOS:

- **Drive the loop yourself.** Set `loop = false` and restart via a `playToEnd` listener calling `player.replay()` — don't rely on the native loop, which re-buffers the HLS seek slowly.
- **Latch the readiness gate.** When the `VideoView` mount is gated on a `videoReady` flag set from `statusChange`, latch it `true` on `readyToPlay` and never reset it on the transient `idle` blip at the loop seam — resetting unmounts the player and forces a full HLS re-init (plus any intro/fade re-run). Reset only on a genuine `error` so a permanent stream failure still falls back to the poster.
- **Guard manual replay against pause races.** If another player (overlay/fullscreen) enforces a single-decoder rule, check the live pause state inside the `playToEnd` callback (via a `useRef` mirror) before calling `replay()`, so a queued end event can't spin up a second decoder.
- **Verify the loop seam in the simulator, not just CI.** Typecheck/eslint/jest cannot see a frozen frame. Deep-link a ~60-70s clip and frame-sample across the loop point (`xcrun simctl io <udid> screenshot` every 2s + md5 compare) — confirm every frame is unique (no frozen run) and that the t=0 start frame reappears at the seam.

## Related Issues

- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — **side effect of this fix's `videoReady` latch.** Latching ready stopped the `VideoView` unmounting at the loop seam, but it _also_ stopped it unmounting when the fullscreen overlay opens — leaving the backdrop's `AVPlayerLayer`/decode slot allocated and starving the overlay player (black, stuck at 0:00). Fixed by gating the `VideoView` mount on `!overlayVisible` (pause alone does not release the slot on tvOS).
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` — baseline TV hero autoplay setup. It documents `p.loop = true` for a looping hero; this fix supersedes that for backdrop/hero looping on tvOS (the native loop is the cause of the seam black-pause). Refresh candidate.
- `docs/solutions/best-practices/mobile-video-detail-page-patterns-20260527.md` — the frozen `creationSource` + `replaceAsync` rule that `VideoBackdrop` inherits (and why the `videoReady` latch is safe — the player is never re-created).
- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` — `playToEnd` listener guard + ref-mirror discipline for native-event callbacks; directly applies to the `overlayVisibleRef` guard and the latched `videoReady`.
- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — non-interactive `VideoView` hero (`pointerEvents="none"`) + poster-hold during HLS swap; the poster-hold gate is what the loop seam was wrongly re-triggering.
