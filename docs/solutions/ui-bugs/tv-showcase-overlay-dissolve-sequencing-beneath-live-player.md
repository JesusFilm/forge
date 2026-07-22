---
title: "A dissolving overlay over a live media player is only as soft as what's beneath it — sequence the covered layers, don't just animate the overlay"
date: "2026-07-20"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
severity: medium
symptoms:
  - "During a chapter card's 420ms dissolve-in, the incoming excerpt's thumbnail (or a blanked, just-released video surface) flashes through the half-transparent card"
  - "The chapter card or stat interstitial occasionally unmounts mid-exit-fade — a jump-cut instead of a dissolve — because the overlay's own exit setTimeout and the reducer's unmount timer target the same nominal instant from two unsynced clocks"
  - "On the failure path, a cross-chapter failExcerpt updates the visible ChapterCard in place; its dissolve effect re-runs on the changed position dep and snaps the opaque card fully transparent before re-dissolving — a full-screen poster flash (found independently by two ce-code-review reviewers)"
  - "At cold start the chapter card dissolved in over a bare thumbnail, because the poster layer initializes at opacity 1 and the dissolve-in only makes sense over live video"
  - "Screenshot-based verification could not catch any of these: 420ms seams fall between capture cadence, and same-second screenshot filenames collide"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - "apps/tv/src/components/showcaseMode/ChapterCard.tsx"
  - "apps/tv/src/components/showcaseMode/StatInterstitial.tsx"
  - "apps/tv/src/components/showcaseMode/ReelPlayer.tsx"
  - "apps/tv/src/components/showcaseMode/ShowcaseScreen.tsx"
  - "apps/tv/src/components/showcaseMode/reelPlayerGate.ts"
  - "apps/tv/src/lib/showcaseMode/reelState.ts"
tags:
  - tv-showcase
  - expo-video
  - overlay-crossfade
  - derived-timing-constants
  - timer-margin
  - react-in-place-reconciliation
  - frame-extraction-verification
  - async-timing
---

# A dissolving overlay over a live media player is only as soft as what's beneath it — sequence the covered layers, don't just animate the overlay

## Problem

The TV showcase reel (`apps/tv`) plays curated excerpts on a single long-lived `expo-video` player whose source is swapped via `replaceAsync` (`apps/tv/src/components/showcaseMode/ReelPlayer.tsx`). A reducer (`apps/tv/src/lib/showcaseMode/reelState.ts`) drives the phases — `resolving` / `chapterCard` / `excerpt` / `interstitial` / `stills` — and the shell (`apps/tv/src/components/showcaseMode/ShowcaseScreen.tsx`) projects each phase onto full-screen overlay components: `ChapterCard.tsx` and `StatInterstitial.tsx`. The single-player constraint is deliberate and repo-level — a two-player crossfade hits a known tvOS decoder/memory trap — so every seam must be masked _around_ one shared player rather than solved by decoder-level crossfading (session history).

The reel gained crossfade seams: chapter cards and interstitials dissolve in over the outgoing excerpt's last frame and dissolve out to reveal the next one. The naive implementation — animate the overlay's own opacity, change nothing else — produced three distinct flash bugs, each one a different way for the layers _beneath_ the overlay to betray the fade. All three were fixed by sequencing what's beneath the overlay, not by touching the overlay's animation. The work is on PR JesusFilm/forge#1610 (open, unmerged at time of writing).

The underlying physics is simple and unforgiving: a fading overlay is at partial opacity for its entire fade duration, so **everything beneath it is visible for the whole fade**. The seam is only as soft as the most abrupt change anywhere in the stack during that window. Animating the top layer buys nothing if a layer below pops, swaps, or blanks mid-fade.

## Symptoms

Three flash classes, one per bug:

1. **Entry flash.** As a chapter card dissolved in over the outgoing excerpt, the incoming excerpt's poster snapped in beneath it, and moments later `replaceAsync` released the outgoing player item — which can blank the video surface. Both changes happened _under a half-transparent card_, so the viewer saw the next thumbnail (or a blank) flash through the dissolve.

2. **Exit jump-cut.** The overlays self-schedule their exit fades with `setTimeout`, while the screen independently schedules the reducer's unmount timers (`CHAPTER_CARD_DURATION_MS` at `ShowcaseScreen.tsx:310-317`, `INTERSTITIAL_DURATION_MS` at `ShowcaseScreen.tsx:319-326`). Aimed at the same nominal instant, JS-thread jitter could fire the unmount first — removing a still-visible card mid-fade as a hard cut.

3. **Failure-path poster flash (in-place reconciliation).** `failExcerpt` can skip across a chapter boundary while the phase _stays_ `"chapterCard"` (`reelState.ts:282-296`: the failed chapter's last item advances into the next chapter via `enterChapterAt`, which re-enters `"chapterCard"`). React reconciles the same unkeyed `ChapterCard` instance with a new `position`; the dissolve effect re-runs on the changed dep and — with only a mount-time latch guarding it — snapped the _visible, fully opaque_ card back to transparent and re-dissolved. Full-screen poster flash, on the path that fires exactly when playback is already failing. Two ce-code-review reviewers found this one independently.

A fourth, related seam: at cold start the poster layer initializes at opacity 1 (`ReelPlayer.tsx:554`), so a dissolving card would play its "soft" entry over a bare thumbnail — a dip with nothing to be soft against.

## What Didn't Work

- **Animating only the overlay's opacity.** This is the root mistake behind all three flash classes. The overlay's fade was correct in isolation every time; the bugs lived in the un-sequenced layers beneath it — the poster cover, the player-item swap, the unmount, the effect re-run.

- **Treating the poster's instant snap as an oversight.** The pre-existing snap-to-opaque was a deliberate earlier design (a guard against Android's previous-frame flash on source swap), built around a load-bearing distinction: dissolve only on an _advance_ (a real outgoing frame is mounted beneath), snap on a _lifecycle cover_ (background/nav-away — nothing beneath to blend into). The covered-swap fix had to preserve that distinction, not replace it: under an overlay the poster now waits, then still snaps — silently, beneath full cover (session history).

- **Zero-margin timer alignment.** Letting the overlay's exit fade end exactly when the reducer's unmount timer fires assumes two independent `setTimeout` clocks on a busy JS thread agree to the millisecond. They don't; order inversion is routine, and each inversion is a visible jump-cut.

- **Prose-comment timing contracts.** The first version of the entry fix used bare literals — 420 / 500 / 600 — in different files, with comments explaining that the cover delays "must outlast the overlay fade." Review flagged it as a silent-retune trap: tightening the crossfade in `reelState.ts` would silently break the contract in `ReelPlayer.tsx` with no compile error and no test failure, only a subtle flash on a TV.

- **A mount-time latch alone for the reconciliation bug.** `ChapterCard` already latched its entry seam at mount (`entersOpaqueRef`, `ChapterCard.tsx:55`), which is correct for what it encodes — the seam the card _entered_ through. It says nothing about effect re-runs on the same mounted instance, which is exactly what a cross-chapter `failExcerpt` produces.

- **Screenshot-based seam verification.** A 420ms seam cannot be reliably caught by taking simulator screenshots: the capture cadence is multi-second, and burst screenshots collide on same-second filenames, silently overwriting the one frame that mattered. This trap has now bitten across multiple sessions on this same reel — earlier showcase work produced repeated false "it's broken" conclusions from screenshot sampling before switching to real screen recording (session history).

## Solution

Three sequencing fixes, one derivation, and a verification loop. All on PR JesusFilm/forge#1610.

### 1. Entry: hold the under-layers back until the overlay covers them

`ReelPlayer` distinguishes a _visible_ seam (`active` — an excerpt-to-excerpt cut, where the poster crossfades over the outgoing frame) from a _covered_ seam (`active === false` — a card or interstitial is on top). Under cover, both under-layer changes are delayed past the overlay's dissolve, then performed silently:

The poster cover waits out the dissolve, then covers with a duration-0 timing (`ReelPlayer.tsx:569-578`):

```ts
: // Covered: wait out the card's dissolve, then cover silently — a visible
  // bloom here is what flashed the incoming thumbnail through the card.
  Animated.sequence([
    Animated.delay(POSTER_COVER_DELAY_MS),
    Animated.timing(posterOpacity, {
      toValue: 1,
      duration: 0,
      useNativeDriver: true,
    }),
  ])
```

The item swap awaits a delay before `replaceAsync`, because releasing the outgoing item can blank the surface (`ReelPlayer.tsx:303-311`):

```ts
// Covered: wait out the overlay dissolve + poster cover before releasing the
// outgoing item, so nothing beneath a half-transparent card can change.
if (!activeRef.current) {
  await new Promise((resolve) => setTimeout(resolve, SWAP_COVER_DELAY_MS))
  if (swapIdRef.current !== swapId) return
}
await player.replaceAsync(target?.hls ?? null)
```

### 2. Make the cross-file timing contract hold by construction

The delays are _derived_, not documented (`ReelPlayer.tsx:43-44`, from `reelState.ts:90`):

```ts
const POSTER_COVER_DELAY_MS = OVERLAY_CROSSFADE_MS + 80
const SWAP_COVER_DELAY_MS = POSTER_COVER_DELAY_MS + 100
```

`OVERLAY_CROSSFADE_MS = 420` lives beside the reducer's other declarative durations in `reelState.ts:90`, with the derivation chain stacking the invariants: the poster covers only after the dissolve is opaque, and the swap runs only after the poster covers. Retune the crossfade and every dependent delay moves with it.

### 3. Exit: an explicit margin between the two clocks

`OVERLAY_EXIT_MARGIN_MS = 120` (`reelState.ts:92` — "Exit fades lead the reducer's own unmount timers by this — two unsynced clocks"). Both overlays schedule their exit fade to _lead_ the unmount rather than tie it (`ChapterCard.tsx:108-115`, and the same expression in `StatInterstitial.tsx:67-74`):

```ts
// The margin keeps the fade ahead of the reducer's own unmount timer.
Math.max(
  0,
  CHAPTER_CARD_DURATION_MS -
    OVERLAY_CROSSFADE_MS -
    OVERLAY_EXIT_MARGIN_MS,
),
```

The unmount now removes a view that finished fading ~120ms earlier — jitter in either clock is absorbed by the margin instead of shown to the viewer.

### 4. In-place re-runs: pair the mount latch with a shown-once latch

`ChapterCard` keeps two refs (`ChapterCard.tsx:53-58`) and consults both at the top of the dissolve effect (`ChapterCard.tsx:79-97`):

```ts
// Mount-time latch: the flag describes the seam this card ENTERED through …
const entersOpaqueRef = useRef(entersOpaque === true)
// A cross-chapter failExcerpt updates this card IN PLACE (new `position`, no
// remount); once shown, stay opaque — never snap transparent and re-dissolve.
const hasShownRef = useRef(false)
…
const skipDissolve = entersOpaqueRef.current || hasShownRef.current
hasShownRef.current = true
```

`hasShownRef` is set in effect _setup_ and never mutated in cleanup, so a StrictMode setup→cleanup→setup cycle cannot poison it (the repo's StrictMode remount law — see `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md`).

Relatedly, the dissolve-in is _reserved_ for the one seam where it means something — card over live video. The shell tracks the previous phase and mounts the card opaque from `resolving`/`stills`/`interstitial` (`ShowcaseScreen.tsx:526-528`):

```ts
const lastPhaseRef = useRef(state.phase)
const cardEntersOpaque =
  state.phase === "chapterCard" && lastPhaseRef.current !== "excerpt"
```

The reducer branch that makes the in-place update reachable is `failExcerpt` (`reelState.ts:287-295`): a failure during the card holds the phase at `"chapterCard"` when the retry stays within the chapter, and re-enters `"chapterCard"` (new `chapterIndex`, new rendered `position`) when the skip crosses the boundary — same phase, same unkeyed component, different props.

### Verifying the fix: record and extract frames

Screenshots cannot catch sub-second seams; the loop that actually works:

```sh
xcrun simctl io <udid> recordVideo seam.mov      # Ctrl-C after the seam plays
ffmpeg -i seam.mov -vf "fps=10,scale=960:-1" frames/f%04d.png
```

Then locate seams by PNG file-size classes instead of eyeballing hundreds of frames: a flat chapter card compresses to ≈8KB, live video runs 400KB+, and blend frames land in between. Sort by size, jump to the class transitions, and read only the boundary frames. Ten frames per second is enough resolution to see whether a 420ms dissolve had anything hard-cutting beneath it.

## Why This Works

- **The fade window is a visibility window.** For the whole `OVERLAY_CROSSFADE_MS`, the overlay is partially transparent in one direction or the other, so the composite the viewer sees is a blend of every layer. The only way a dissolve reads as soft is if the covered layers are static for the entire window — which means every under-layer change must be scheduled _after_ the entry fade completes and _before_ the exit fade begins. That is a sequencing problem, not an animation problem.

- **Derivation turns a prose invariant into a structural one.** "The cover delays outlast the fade" was true of the literals 420/500/600 only by coincidence of their current values. `OVERLAY_CROSSFADE_MS + 80` and `POSTER_COVER_DELAY_MS + 100` are true by construction, across files, under any retune.

- **The margin acknowledges that two timers are two clocks.** The overlay's exit `setTimeout` and the screen's unmount `setTimeout` are started by different effects at slightly different commits and both slip under JS-thread load. No exact alignment exists to be had; a 120ms lead converts a race into a guarantee (the unmount always removes an already-transparent view), at the cost of the card sitting fully faded-out for an imperceptible beat.

- **The shown-once latch encodes the right fact.** The mount latch answers "what seam did this card enter through?" — a per-mount fact. The reconciliation bug needed a different fact: "has the viewer already seen this card opaque?" — a per-instance fact that survives prop-driven effect re-runs. Once shown, the only acceptable behavior is to stay opaque; the new `position` still animates its own copy entrance (the `enter` value), so the update reads as the card's _content_ changing, never the card itself blinking.

- **File-size classes make frame triage mechanical.** Compression is a free classifier: flat synthetic frames, photographic frames, and blends occupy disjoint size bands, so the boundary frames — the only ones that can contain a flash — identify themselves.

## Prevention

Generalizable laws, in decreasing order of how often they'll bite:

1. **Before shipping any overlay dissolve, enumerate every layer visible through the fade — then sequence them.** For each layer beneath the overlay, ask: can this change (mount, unmount, swap, snap, load) during the fade window? Every "yes" needs to be either held back until the overlay is opaque, performed silently under full cover, or completed before the fade starts. The overlay's own animation is the _last_ thing to write, not the first.

2. **Two unsynced timers targeting one instant need an explicit margin.** If component A animates toward a moment that component B's timer enacts (unmount, phase flip, navigation), never aim both at the same value — give the animation an explicit lead (`OVERLAY_EXIT_MARGIN_MS`-style, named and shared), sized above worst-case scheduler jitter.

3. **Cross-file timing chains hold by construction — derive, don't document.** Any "X must outlast Y" contract spanning files must be expressed as arithmetic on a single exported base constant. A comment stating the contract is a retune trap; a derivation is the contract.

4. **Any same-type overlay rendered unkeyed across state transitions must tolerate in-place effect re-runs.** If a state machine can re-enter a phase (or mutate the props of its overlay) without changing the rendered component type, React reconciles in place and mount-time assumptions in animation effects are wrong. Either key the component on the transition identity (forcing a remount — but then the remount seam must itself be designed) or latch "already shown" per instance, with the latch set in effect setup and never mutated in cleanup (StrictMode-safe).

5. **Record-and-extract-frames is the verification contract for sub-second seams.** Screenshots are structurally blind to anything shorter than their cadence and collide on same-second filenames — a trap that has now produced false "it's broken" conclusions in more than one session on this reel (session history). For any transition under ~1s: `xcrun simctl io recordVideo` → `ffmpeg -vf fps=10` → triage frames by file-size class → read only the boundary frames. Treat a seam as unverified until it has survived this loop.

## Related Issues

- `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md` — why the shown-once latch must be setup-set, never cleanup-cleared.
- `docs/solutions/integration-issues/expo-video-replaceasync-seek-silently-dropped-tvos.md` — same `ReelPlayer.tsx` swap effect, same PR lineage: the seek hazard the poster hides beneath these overlays.
- `docs/solutions/integration-issues/expo-video-timeupdate-clock-drift-audio-fade-hardcut.md` — sibling boundary-timing hazard on the same reel (audio fade vs platform clock drift).
- `docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md` — the same reel's watchdog history; its "paired state must share a lifetime" rule is the sibling discipline to derive-don't-document.
- `docs/solutions/design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md` — the mobile ancestor of overlay-fade-vs-state races and pure-reducer testability.
