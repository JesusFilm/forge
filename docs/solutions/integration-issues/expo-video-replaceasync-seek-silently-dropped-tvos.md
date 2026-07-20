---
title: "expo-video seek issued right after replaceAsync is silently dropped on tvOS, breaking TV Showcase Mode's curated excerpt windows"
date: "2026-07-20"
module: apps/tv
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "TV Showcase Mode reel plays every mid-video excerpt from the beginning instead of the curated in-point whenever window.startSeconds is greater than 0"
  - "Excerpt duration runs roughly 2-2.5x the intended ~40s window (80-105s+ observed) because playback continues from position 0 until currentTime reaches the absolute endSeconds value"
  - "No error, stall, or watchdog trip occurs — currentTime keeps advancing and the natural playToEnd check still fires, so the defect produces no observable failure signal"
  - "Latent in shipped code for weeks: the shipped fallback reel is short-form-first so all windows start at 0, and the startSeconds > 0 seek guard was never exercised on a real device until the tv-showcase Experience (published 2026-07-18) introduced long-form picks"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - expo-video
tags:
  - expo-video
  - tvos
  - avplayer
  - seek
  - showcase-mode
  - reel-player
  - async-timing
---

# expo-video seek issued right after replaceAsync is silently dropped on tvOS, breaking TV Showcase Mode's curated excerpt windows

## Problem

apps/tv Showcase Mode plays a reel of short curated excerpts. Each excerpt is a bounded window into a catalog video — a `{ startSeconds, endSeconds }` pair computed by `resolveExcerptWindow` in `apps/tv/src/lib/showcaseMode/sourceResolution.ts:360`. Short items play from the top (`startSeconds: 0`); anything longer than the 40s excerpt band starts roughly 15% in (`LONG_FORM_OFFSET_RATIO = 0.15`, line 33), so the viewer lands on a meaningful mid-video moment rather than a slate or a title card. For a 283s video the window is `[42, 82]` — start at 42s, run 40s, stop at 82s.

The reel uses one long-lived player and swaps its source with `replaceAsync` (a second player is expo-video's AVPlayerViewController leak trigger — see the header of `apps/tv/src/components/showcaseMode/ReelPlayer.tsx:1`). Immediately after the swap resolves, the code seeks the player to the window start:

```ts
// ReelPlayer.tsx — the swap effect, ~line 300
await player.replaceAsync(target?.hls ?? null)
if (swapIdRef.current !== swapId) return
loadedStreamRef.current = target
loadedTokenRef.current = token
if (target == null) return
// R6's bounded window: long-form starts mid-video, the seek under the poster.
if (target.window.startSeconds > 0) {
  player.currentTime = target.window.startSeconds
}
```

On tvOS, that `player.currentTime = X` write is **silently dropped** when the AVPlayer item is not yet seekable at the instant `replaceAsync` resolves. No error, no rejected promise — the write simply does nothing. Playback then begins at 0:00 instead of the window start. Because the reel's end check compares the live clock against the **absolute** `endSeconds` (`ReelPlayer.tsx:440` — `if (currentTime < loaded.window.endSeconds) return`), the excerpt runs from 0:00 all the way to the absolute `endSeconds`. The `[42, 82]` window played 0→82s: 82 seconds of the video's opening footage instead of the intended 40 seconds of the curated moment.

The bug was **latent in shipped code for weeks**. The seek is gated on `if (target.window.startSeconds > 0)`, and the shipped fallback reel (`buildFallbackChapters`, `sourceResolution.ts:249`) is short-form-first — its leading items resolve to `startSeconds: 0`, so the guarded seek branch never ran on-device. The guarded path first executed in production when the curated `tv-showcase` Experience (published 2026-07-18) introduced long-form picks with non-zero window starts.

## Symptoms

- Every long-form excerpt (window `startSeconds > 0`) played the video's **opening footage** — the exact frames the mid-video window was designed to skip.
- Each such excerpt ran for its **absolute `endSeconds`** (~82–97s for the real windows) instead of the intended ~40s. Single-video spans of 82–105s were observed on-device.
- **Completely silent.** No error was thrown or logged. The player never entered an error state.
- The liveness watchdog was **satisfied**: its heartbeat only checks that position _advances_ (`ReelPlayer.tsx:396` — `positionMoved`), and a video playing straight through from 0:00 advances normally. A dropped seek is invisible to a "did the playhead move?" watchdog.
- If watchdog enforcement never fired, the reel still advanced on natural `playToEnd`, so the reel never _stalled_ — it just showed the wrong content for the wrong duration and moved on.
- Recognizable shape: **content plays, but from the wrong position and/or for the wrong length, with zero errors.**

## What Didn't Work

**Trusting green tests.** The full suite (1,144 jest tests + typecheck) passed throughout. The window arithmetic (`resolveExcerptWindow`) and the enforcement predicates are pure and fully unit-tested — but the mocked player seam **cannot** exercise the native seek contract. This is the repo's mocked-shape-vs-real-contract law again: mocked tests prove branch shape, real hardware proves the native contract. A test that asserts "we called `player.currentTime = 42`" is green whether or not tvOS honored the write.

**Wall-clock sampling nearly misdiagnosed it.** The first on-device smoke paced screenshots with `read -t N </dev/null` for the between-shot sleeps. Under zsh that returns **instantly** (EOF on stdin is not a timeout), so the actual sampling cadence was screenshot overhead (~6–8s), not the intended 22–60s. The corrupted timeline briefly suggested a different, scarier failure — "enforcement fully dead, videos playing to their natural end." The measurement was only trustworthy once timestamps were anchored **into the screenshot filenames** via `date +%H%M%S` and the sleeps used a real clock (`python3 -c "import time; time.sleep(N)"`).

**Hypotheses eliminated by reading code and data, not by patching:**

- _Confirm-token guard permanently unequal._ If `confirmedToken` never matched `loadedToken`, the window checks would be skipped — but that state also starves the watchdog's load budget and would have tripped it. It didn't, so the guard was passing.
- _Milliseconds-vs-seconds unit mismatch on duration._ The schema says `video_dub.duration` is INT **seconds**; if it were milliseconds the window math would effectively never fire. Ruled out because the observed spans matched the absolute-`endSeconds` model exactly.
- _My-branch regression._ `git diff` against `main` showed the seek code untouched on this branch — it ships in the base from the PR #1595 era (`ReelPlayer.tsx` last changed on `main` in `d39f6ce6`).

**The decisive model fit.** Real dub durations pulled from the DB (282–380s) predict windows `[42,82]`, `[57,97]`, `[43,83]`. Observed single-video spans of ~64–105s match "plays 0 → absolute `endSeconds`" precisely, and the on-screen content was opening footage. The model — dropped seek, absolute-end check — fit the measurements exactly.

## Solution

Stop trusting the one-shot post-`replaceAsync` seek to land, and **self-heal at the choke point** every playing clock already flows through: the `timeUpdate` handler.

A pure, tolerance-guarded predicate decides when a re-seek is owed (`apps/tv/src/components/showcaseMode/reelPlayerGate.ts:113`):

```ts
/**
 * AVPlayer seeks land on keyframes, so a LANDED seek can settle a few seconds shy of
 * the requested start; only a gap past this is a dropped seek needing the heal.
 */
export const WINDOW_SEEK_TOLERANCE_SECONDS = 4

export function needsWindowStartSeek(args: {
  currentTime: number
  startSeconds: number
}): boolean {
  return (
    args.startSeconds > 0 &&
    args.currentTime + WINDOW_SEEK_TOLERANCE_SECONDS < args.startSeconds
  )
}
```

In the `timeUpdate` handler, the heal sits **after** the confirmed-token guard and **before** the QoE/fade/end checks.

**Before** (`ReelPlayer.tsx`, the confirmed-source branch of `timeUpdate`):

```ts
if (confirmedTokenRef.current !== loadedTokenRef.current) return
// straight into the confirmed source's own clock:
qoeRef.current?.onTimeUpdate(currentTime)
// ...fade-out arming, then the window-end check
```

**After** (`ReelPlayer.tsx:406`):

```ts
if (confirmedTokenRef.current !== loadedTokenRef.current) return
// The post-swap seek can be silently dropped (item not yet seekable on tvOS);
// heal forward until the clock is inside the window, and skip this tick's
// QoE/fade/end checks — a pre-seek position would pollute all three.
if (
  needsWindowStartSeek({
    currentTime,
    startSeconds: loaded.window.startSeconds,
  })
) {
  try {
    player.currentTime = loaded.window.startSeconds
  } catch {
    // Native player already released; the next swap owns recovery.
  }
  return
}
qoeRef.current?.onTimeUpdate(currentTime)
// ...unchanged from here
```

The original post-`replaceAsync` seek is **kept** — it is harmless (and free) when the item happens to be seekable in time. The heal is the backstop for when it isn't.

On-device verification (tvOS simulator; the hardware soak is a pending feat-262 tail item): **before** — excerpt boundaries at 80–105s+ showing opening footage; **after** — boundaries at 40–46s showing the intended mid-video content; full reel loop ~26 minutes, inside the plan's 20–35 minute band.

## Why This Works

- **It heals at the point of truth.** The `timeUpdate` handler is the one place that observes the player's _actual_ clock every second. Instead of trusting a fire-once write to have taken effect, the code re-checks the real position and re-issues the seek whenever the clock is still meaningfully below the window. The fix is a property of the running loop, not of one native call succeeding.

- **It converges, and it can't loop.** Once a re-seek lands, `currentTime` jumps to ~`startSeconds`, and `startSeconds + 4 < startSeconds` is false, so the predicate stops firing — the heal settles within 1–2 ticks of confirmation. The `WINDOW_SEEK_TOLERANCE_SECONDS = 4` band exists because AVPlayer seeks snap to keyframes and a _landed_ seek can settle a few seconds shy of the exact target; without the tolerance, a keyframe that lands at 40s for a 42s target would re-seek forever.

- **The early `return` protects the rest of the tick.** A pre-seek clock reading is the video's 0:00 opening, not the excerpt. Letting it through would pollute `watched_ms` (QoE), arm the audio fade-out against the wrong remaining time, and — worst — satisfy the absolute-`endSeconds` end check against a bogus position. Returning for that tick keeps all three honest until the clock is genuinely inside the window.

- **It's ordered after the confirmed-token guard on purpose.** Before a swap's source is confirmed, the clock still reports the _outgoing_ excerpt's position. Healing on that would seek the wrong stream. The guard (`confirmedTokenRef.current !== loadedTokenRef.current`) ensures the heal only ever acts on the source the reel is actually asking for.

- **It also covers the language-hop seeks for free.** Each hop into the language centerpiece re-seeks mid-video into a different dub — the same class of post-swap seek that can be dropped. Because the heal keys on the _loaded_ window's `startSeconds`, it fixes hop seeks with no extra code.

## Prevention

- **A `cond ? exercised : skipped` guard around a native side effect ships the skipped path unproven.** Here, `if (startSeconds > 0)` meant the seek branch never ran in the short-form-first fallback reel, so the drop stayed latent for weeks until curated long-form content first exercised it. Any conditional guarding a native call needs **at least one real-device exercise of the guarded branch** before ship — the common case masking the guarded case is exactly how this hid.

- **On-device timing verification belongs in the verification contract for any window / seek / timing feature.** Unit tests and the tvOS _simulator_ prove the math; they do not prove the native seek contract. If a feature computes _where_ or _how long_ something plays, the done-criteria must include measuring real playback on hardware.

- **Recognize the symptom shape early:** _content plays, but from the wrong position or for the wrong length, with no errors_ → suspect a **dropped native seek first**, before chasing units, guards, or regressions. A liveness watchdog that only checks "did the playhead advance?" is blind to it, because a wrongly-positioned playhead still advances.

- **Measurement discipline for reel / timing smokes.** Anchor wall-clock into the artifact filenames (`date +%H%M%S` in the screenshot name) so the timeline is self-describing, and use a **real** sleep (`python3 -c "import time; time.sleep(N)"`). `read -t N </dev/null` does **not** sleep under zsh — it returns instantly on stdin EOF, collapsing your sampling cadence to tool overhead and inviting a misdiagnosis.

- **Prefer self-heal-at-the-choke-point over one-shot fixes.** A single listener or a fire-once write assumes its one moment succeeded. Routing the correction through the loop that already observes real state — made idempotent, converging, and tolerance-guarded — turns "did that one call take?" from a silent failure mode into a self-correcting one.

## Related Issues

- Fix: PR JesusFilm/forge#1610, commit `fix(tv): self-heal window-start seeks the player silently drops` (PR open/unmerged at time of writing; the repo squash-merges, so cite the PR, not a branch SHA)
- Same-file sibling (different mechanism — a session-lifetime ref outliving an arm-lifetime ref in the same gate machinery): `docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md`
- Same-file sibling (different mechanism — Android timeUpdate clock drift vs a dropped seek; together the reel's three timing laws): `docs/solutions/integration-issues/expo-video-timeupdate-clock-drift-audio-fade-hardcut.md`
- META law this is a worked instance of (mocked tests prove branch shape; only a real device proves the native contract — here the unexercised guarded branch shipped unproven): `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
- expo-video readiness quirks in the same player family (transient idle status, `videoReady` latch): `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md`
