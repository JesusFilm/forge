---
title: "Two-slot expo-image crossfade stalls on A->B->A (onLoad never re-fires for a cached back slot)"
date: 2026-06-15
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Focus card A, then B, then back to A: the full-bleed backdrop stays frozen on B's artwork while the billboard correctly shows A"
  - "Backdrop and foreground are out of sync — right card content, wrong ambient background image"
  - "The crossfade silently never starts — no error, no flash, just a frozen layer"
  - "Only reproduces when returning to a previously-shown card (A->B->A, A->B->C->B); first visit to any card crossfades correctly"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags:
  - "tv"
  - "tvos"
  - "expo-image"
  - "crossfade"
  - "onload"
  - "two-slot"
  - "backdrop"
  - "async-timing"
related_components:
  - "apps/tv/src/components/home/HomeBackdrop.tsx"
---

# Two-slot expo-image crossfade stalls on A->B->A (onLoad never re-fires for a cached back slot)

## Problem

The TV Home full-screen ambient backdrop crossfades the focused card's artwork using two stacked `expo-image` slots that swap opacity. Navigating focus A -> B -> A left the backdrop frozen on B while the billboard showed A — the backdrop and foreground went permanently out of sync until focus moved to a third distinct card.

## Symptoms

- After A -> B -> A, the backdrop shows B; the billboard, title, and meta show A.
- The crossfade stalls silently — no error, no flash-to-blank, just a frozen backdrop layer.
- Reproduces on any return to a previously-displayed card (the common D-pad pattern of moving right then back left); first-time visits crossfade correctly.

## What Didn't Work

The effect already guarded the "target is already on the **front** slot" case (a no-op restore of resting opacities). That covers re-focusing the currently-visible card, but not the case where the target sits in the hidden **back** slot — already loaded, not visible. That second case is exactly A -> B -> A.

## Solution

Two changes in `apps/tv/src/components/home/HomeBackdrop.tsx`.

**1. Back-slot-already-loaded guard (the core fix).** The incoming slot fades in only on its `<Image>` `onLoad`, and each slot's `<Image>` is keyed by URL. When the target artwork already sits loaded in the back slot, its URL-keyed `<Image>` does not remount, so `onLoad` never re-fires and the pending-crossfade callback never runs. Detect that case and crossfade directly:

```tsx
// (after the existing "already on the front slot" guard)

// Back slot ALREADY holds the target artwork (e.g. A->B->A): its Image is
// mounted and loaded, so its URL-keyed onLoad will NOT fire again. Waiting
// on pendingRef for that load would stall forever. Crossfade directly.
if (imageUrl != null && slotUrlsRef.current[back] === imageUrl) {
  pendingRef.current = null
  startCrossfade(back, generation)
  return
}
```

**2. Eager front-index intent.** Mark the target slot as the new front when the crossfade _starts_, not in its completion callback. A focus change that supersedes an in-flight fade then reads the correct front/back (and the guard in change 1 compares against the right slot) instead of a stale value:

```tsx
const startCrossfade = useCallback((slot, generation) => {
  if (generation !== generationRef.current) return
  const opacities = slotOpacitiesRef.current
  const other = slot === 0 ? 1 : 0
  frontIndexRef.current = slot // eager: intent, not completion
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
}, [])
```

## Why This Works

Keying each `<Image>` by URL is deliberate — it stops a stale frame from a prior swap painting mid-crossfade. The side effect is that returning to an already-loaded URL does not remount the `<Image>`, so `onLoad` (which fires once per mount) does not re-fire. The fix skips the pending-load wait for that case and raises the slot's opacity directly; the bytes are already in `expo-image`'s cache, so there is nothing to wait for. The eager front-index keeps the two-slot bookkeeping correct when focus moves faster than a 600ms fade.

## Prevention

- **Any fade/transition gated on a load or async event needs a synchronous already-satisfied fast path.** If the awaited content may already be present (cached image, preloaded asset, already-mounted component), check for it and proceed without waiting for an event that won't fire.
- **For two-slot crossfades, treat "target already in either slot" as two distinct cases:** front slot -> already visible, restore; back slot -> already loaded but hidden, crossfade directly. Handle "neither / front / back" explicitly.
- **Make the slot orchestration unit-testable.** The which-slot-is-front / pending-load / three-branch logic lives inside a `.tsx` component and is currently verifiable only by simulator smoke — and the A->B->A case is easy to miss in manual testing unless specifically exercised. Extracting it to a pure helper or a `useBackdropCrossfade` hook (the way `homeScrollState.ts` and `showcaseState.ts` were extracted for jest-expo) would let a unit test pin the back-slot case.

## Related Issues

- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — Section 2 covers the crossfade architecture (stacked layers keyed by id) but not this `expo-image` `onLoad` re-fire gotcha.
- `docs/solutions/ui-bugs/tv-backdrop-videoview-decoder-starvation-overlay-20260611.md` — the **video** backdrop on the watch screen (`VideoBackdrop`); this is the **image** backdrop on Home (`HomeBackdrop`) — different component and root cause.
- `docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop-20260609.md` — adjacent backdrop-lifecycle doc, but `expo-video` `statusChange` semantics, not `expo-image` `onLoad`.
