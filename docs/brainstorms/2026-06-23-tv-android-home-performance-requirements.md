---
date: "2026-06-23"
topic: "tv-android-home-performance"
---

## Summary

Make Android TV home-page D-pad navigation smooth by cutting per-move **UI-thread** cost. Measure-gated, two-phase: low-risk per-frame/per-focus reductions first, re-profile, then off-screen rail virtualization only if the UI thread is still saturated. Apple TV keeps its current visual treatment unchanged.

## Problem Frame

On the home screen (`apps/tv/app/index.tsx`), moving focus with the D-pad feels delayed and janky on Android TV. A `dumpsys gfxinfo` capture on a Chromecast with Google TV (Sabrina) during a D-pad navigation sweep measured **117 of 117 frames janky (100%)**, **50th-percentile frame 150ms** (99th 250ms; 60fps budget is 16ms), **72 frames flagged "Slow UI thread"**, and **91 missed vsyncs**. The bottleneck is the main/UI thread (CPU), not the GPU (GPU frame timing isn't reported on this SoC, so GPU contribution is unconfirmed but secondary to the positive UI-thread signal).

The dominant cost is work proportional to the mounted view tree and per-focus re-renders: all ~8 section rails mount at once (`app/index.tsx:440` is `sections.map(...)`, no vertical virtualization), and each focus move runs heavy work — `HomeBackdrop`'s ~600ms full-screen image crossfade, a showcase-reducer commit, programmatic scroll, and offscreen-composited card focus visuals — competing on the same thread as the focus animation.

This lag became _visible_ only because the focus fix on this branch turned per-view `onFocus` on for Android for the first time (previously the animations never fired). It is the natural follow-up to that fix, not a regression of it.

## Key Decisions

- **Pragmatic trade-off line, Android-only.** Keep tvOS full-fidelity; on Android, lighten the heaviest effects where it buys fluidity. All Android cuts are gated by `Platform.OS === "android"`.
- **Measure-gated, two-phase.** Phase 1 is low-risk per-frame/per-focus reductions with no structural change. Re-profile on Sabrina. Phase 2 (virtualization) proceeds only if Phase 1 misses the target — it carries the real risk to the focus nav.
- **Floor device is the cheapest Chromecast with Google TV (Sabrina).** Success is judged by gfxinfo on that device, against the 2026-06-23 baseline above.
- **Diagnosis is UI-thread-bound.** Optimizations target re-render fan-out, mounted-tree size, and thread contention first — not GPU effects — because that's what the measurement shows.

## Requirements

**Measurement & gating**

- R1. Define a repeatable D-pad navigation sequence and capture a `dumpsys gfxinfo` jank profile on the Sabrina Chromecast as the baseline, and after each phase. Same sequence each time so numbers compare.
- R2. Phase 2 (structural virtualization) is undertaken only if post-Phase-1 re-measurement still misses the Success Criteria target.

**Phase 1 — per-frame / per-focus cost reduction (no structural change)**

- R3. A single focus move must re-render only the card(s) gaining/losing focus, not the whole rail set. Re-render fan-out from `setBrowseState` / showcase dispatch / `setBelowTopmost` must be contained via memoization and stable props/callbacks.
- R4. All focus, hero, and backdrop animations run on the native driver — no JS-thread per-frame interpolation competing with focus handling.
- R5. Heavy per-move work (backdrop update, showcase commit, programmatic scroll) must not run mid-traversal — it fires only after focus settles, so a fast D-pad sweep stays cheap.
- R6. On Android, replace the offscreen-composited card focus treatment (`needsOffscreenAlphaCompositing`, `renderToHardwareTextureAndroid`, animated shadow) with a lighter ring. tvOS keeps the current treatment.
- R7. On Android, the ambient backdrop must be cheaper: decoupled from per-card focus (e.g. update on rail change / on settle, with a snap or short transition) rather than a full-screen 1080p crossfade per focused card.
- R8. Throttle concurrent image loading so the home does not kick off ~50+ image decodes at once on mount.

**Phase 2 — gated structural change**

- R9. If Phase 1 misses target, mount only the rails near the viewport (windowed/virtualized vertical list), expanding as focus descends, so off-screen rails are not laid out or drawn.
- R10. Virtualization must preserve the existing D-pad navigation contract intact: cross-rail `nextFocus` wiring, `restoreLastFocus`, row-anchored programmatic scroll, hero↔rail focus bridging, and the `RailPad` over-hang catcher must all still work.

**Cross-cutting guards**

- R11. No tvOS behavior or visual change — every Android-specific reduction is platform-gated.
- R12. No regression to the just-shipped Android focus visibility: focus rings/scale must still appear and track the focused element on every move.

## Success Criteria

- SC1. On Sabrina, during the R1 sequence: janky frames drop from 100% and median frame-time falls well below the current 150ms. **Phase 1 target (to confirm):** < 50% janky and median < 33ms (30fps floor). **Phase 2 / stretch target:** < 10% janky and median ≈ 16ms (60fps). Missed-vsync count drops proportionally.
- SC2. Subjectively, a D-pad sweep across a rail and between rails tracks key presses without visible lag on Sabrina.
- SC3. Apple TV navigation and visuals are unchanged (no measurable or visible regression).

## Scope Boundaries

**In scope**

- The home screen focus/navigation path (`app/index.tsx` and its home components) on Android TV.

**Out of scope (this brainstorm)**

- Other screens (watch, search, series) — except where a shared fix (e.g. the `Pressable` bridge or image throttling) improves them for free.
- Initial-load time and idle-ambient (hero auto-advance) smoothness as separate goals — addressed only insofar as the D-pad-nav work also helps them.
- Any tvOS visual or behavioral change.

## Risks / Assumptions

- **Virtualization vs. focus nav (primary risk).** The home's focus system assumes all rails are mounted; windowing them (R9) can break cross-rail `nextFocus` / `restoreLastFocus` / row-anchored scroll. This is why Phase 2 is gated, not upfront.
- **GPU contribution unconfirmed.** Sabrina doesn't report GPU frame timing; the diagnosis rests on the "Slow UI thread" signal. If Phase 1 underperforms versus the predicted UI-thread savings, revisit the GPU/offscreen-compositing hypothesis before Phase 2.
- **Sabrina is the floor device.** If a cheaper/weaker target device is in play, the targets and gating change.

## Outstanding Questions

**Resolve before planning**

- Confirm the concrete jank target numbers in SC1 (or set different ones).
- On Android, is reducing the backdrop acceptable, or should it be droppable entirely if measurement shows it's the dominant per-move cost?

**Deferred to planning**

- Exact memoization boundaries and which state updates fan out today (a render-count probe will pinpoint R3).
- Virtualization mechanism for R9 (e.g. `FlatList` vs `FlashList` — `apps/mobile` already uses `FlashList`).
- The precise definition of the R1 measurement sequence.

## Sources / Research

- `apps/tv/app/index.tsx:440` — `model.sections.map(...)`: vertical rails are not virtualized (all mount at once).
- `apps/tv/src/components/home/HomeRail.tsx` — each rail is a horizontal `FlatList` (within-rail virtualized).
- `apps/tv/src/components/home/HomeCard.tsx`, `apps/tv/src/components/FocusableCard.tsx` — animated scale/ring/shadow; Android offscreen compositing on focus.
- `apps/tv/src/components/home/HomeBackdrop.tsx` — ~600ms full-screen image opacity crossfade per focus settle.
- gfxinfo baseline (Sabrina Chromecast, 2026-06-23): 117/117 janky, 50th 150ms / 99th 250ms, 72 slow-UI-thread, 91 missed-vsync.
- The `Pressable` → `tvFocusEventHandler` focus bridge on this branch (`patches/react-native-tvos@0.81.5-2.patch`) is what made the home animations fire on Android, surfacing this cost.
