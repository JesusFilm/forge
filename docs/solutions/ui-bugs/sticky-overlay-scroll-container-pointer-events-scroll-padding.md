---
title: "Sticky overlay inside a scroll container needs transparent-zone-scoped click-through, scroll-padding, AND a pre-resize re-pin basis"
date: "2026-07-15"
last_updated: "2026-07-20"
category: ui-bugs
module: apps/chat
problem_type: ui_bug
component: chat-composer
symptoms:
  - "Clicks over the opaque bottom strip and side gutters of the sticky composer overlay pass through to invisible transcript content (source links, Retry/Start-new buttons) scrolled beneath it"
  - "Tab-focusing a below-fold transcript link auto-scrolls it behind the sticky composer overlay instead of into view, hiding the new :focus-visible outline too"
  - "A green 418-test jsdom suite shipped both defects — jsdom does not model hit-testing geometry or focus-driven scroll behavior"
  - "ResizeObserver re-pin clamp `distance - Math.max(delta, 0)` evaluates the POST-shrink distance, yanking a reader scrolled in the formula-attributable ~157-220px band above the bottom when a grown composer draft clears"
  - "Original browser verification probed the no-yank case at 300px up — outside the discriminating ~157-220px window — so manual smoke passed while the shrink-direction bug shipped"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "apps/chat/src/components/chat/chat.tsx"
  - "apps/chat/src/components/chat/composer.tsx"
  - "apps/chat/src/app/globals.css"
tags:
  - "sticky"
  - "scroll-container"
  - "pointer-events"
  - "scroll-padding"
  - "resize-observer"
  - "re-pin"
  - "chat"
  - "jsdom-limits"
---

# Sticky overlay inside a scroll container: scoped click-through, scroll-padding, and a pre-resize re-pin basis — the layout halves aren't testable in jsdom

**The general law:** a sticky/floating overlay placed INSIDE a scroll container needs ALL THREE of these, every time:

1. **Click-through (`pointer-events-none`) scoped strictly to the overlay's transparent zones.** Every fully-opaque region of the overlay band (solid gradient strip, side gutters, the card itself) must intercept pointer events — otherwise invisible content scrolled beneath the opaque region still receives clicks.
2. **`scroll-padding-bottom` on the scroll container, sized to the overlay's height.** Browser focus auto-scroll (and `scrollIntoView`) targets the scrollport edge and knows nothing about overlays inside the scroller — without scroll-padding, Tab parks focused elements exactly behind the band: focused but invisible.
3. **(feat-270 addendum) When the overlay RESIZES, any near-bottom re-pin decision must compare the PRE-resize distance from the bottom** — recovered as `distance_after - delta`, valid for grow AND shrink. A directional clamp on the compensation silently yanks scrolled-up readers on shrink. See "The third half of the law" below.

And none of these failures is observable in jsdom (the third's decision ALGEBRA is unit-testable — see its Prevention bullet — but the failure itself, through layout + ResizeObserver, is not). The first two shipped through typecheck, lint, and a green 418-test unit suite; only browser-driven verification (`document.elementFromPoint` hit-testing and a focus-probe rect comparison) caught them. The third shipped past an under-scoped manual browser probe too — see below.

## Problem

apps/chat's conversation pane (`apps/chat/src/components/chat/chat.tsx`) was restructured so the composer is a `sticky bottom-0` overlay INSIDE the `overflow-y-auto` scroller, wrapped in a `min-h-full` flex column (transcript `flex-1`) so it stays pinned when content is short, with a `bg-gradient-to-b` "protection fade" and pointer-events layering (shipped via feat-267's [PR #1617](https://github.com/JesusFilm/forge/pull/1617), merged).

The restructure fixed a real bug: previously the composer was a flex SIBLING of the scroller, so the scrollport ended at the composer wrapper's `pt-16` padding — the transcript clipped ~100px above the composer, and the fade gradient faded over its own empty padding, never over text. The before shape (as it stood before PR #1617):

```tsx
<div ref={logRef} role="log" className="min-h-0 flex-1 overflow-y-auto px-8 pt-12">
  <div className="mx-auto w-full max-w-[680px] pb-10">{/* transcript */}</div>
</div>
{/* sibling of the scroller — scrollport ends above it */}
<div className="sticky bottom-0 bg-gradient-to-b from-transparent via-hearthblack/85 to-hearthblack px-8 pt-16 pb-8">
  <Composer ... />
</div>
```

But sticky-overlay-inside-scroller has two non-obvious failure modes, BOTH introduced in the first pass of the restructure, BOTH caught by adversarial code review plus independent browser validation, BOTH invisible to jsdom.

## Symptoms

- **Click-through over opaque zones:** `pointer-events-none` on the whole sticky band (intended: keep text under the transparent fade scrollable/selectable) also applied to the band's fully-opaque bottom strip and side gutters. Transcript content scrolled beneath those regions was INVISIBLE (opaque gradient above it) but still received clicks — `document.elementFromPoint` over the opaque strip resolved to underlying source links (`<a target="_blank">` in `sources-list.tsx`) and Retry / Start-new buttons. A user clicking near the composer could trigger invisible link navigation.
- **Keyboard focus parks behind the overlay:** Tab to a below-fold transcript link auto-scrolled it just inside the scrollport bottom edge — i.e. exactly behind the sticky band. Focused but invisible, hiding the very `:focus-visible` lamplight outline added the same day (`apps/chat/src/app/globals.css:88-91`, `@layer base`).
- No test, typecheck, or lint signal for either: the full jsdom suite (418 tests) stayed green throughout.

## What Didn't Work

- **`pointer-events-none` on the entire sticky band.** Correct instinct (the transparent fade must not block scrolling/selecting the text dissolving under it), wrong scope: it also disarmed hit-testing over the opaque strip and gutters, exposing invisible interactive elements underneath.
- **Relying on the unit suite / jsdom to catch layout-interaction bugs.** jsdom has no layout, no hit-testing, no focus auto-scroll — both failures are structurally invisible to it.
- **Assuming browser focus auto-scroll accounts for overlays.** It scrolls the focused element to the scrollport edge; a sticky element inside the scroller is not part of that calculation.

## Solution

Current tree, `apps/chat/src/components/chat/chat.tsx` (shipped via feat-267's PR #1617):

**Fix 1 — split the pointer-events layers (the `data-composer-band` wrapper, chat.tsx:230-235 as of feat-270's tree).** `pointer-events-none` stays on the outer sticky wrapper, which now carries ONLY the transparent `pt-16` fade; a full-width `pointer-events-auto` inner div carries the `px-8 pb-8` (the opaque strip and gutters) and intercepts everything over the opaque zone:

```tsx
{/* Sticky INSIDE the scroller so text dissolves through the gradient
    instead of clipping. Only the transparent fade is click-through;
    the full-width inner wrapper intercepts over the opaque zone. */}
<div className="pointer-events-none sticky bottom-0 bg-gradient-to-b from-transparent via-hearthblack/85 to-hearthblack pt-16">
  <div className="pointer-events-auto px-8 pb-8">
    <div className="mx-auto w-full max-w-[680px]">
      <Composer ... />
    </div>
  </div>
</div>
```

Verified in headless Chromium: `elementFromPoint` over the strip/gutters resolves to the intercepting wrapper; over the transparent fade it still reaches the transcript text (selection and scroll preserved).

**Fix 2 — scroll-padding on the scroller (the `data-chat-scroller` div, chat.tsx:196-199 as of feat-270's tree).**

```tsx
<div
  ref={logRef}
  className="min-h-0 flex-1 overflow-y-auto [scroll-padding-bottom:13rem]"
>
```

The browser then treats the bottom 208px as off-limits when scrolling elements into view. Verified with a focus probe: focused link bottom at y=591 vs band top at y=617 after the fix.

## Why This Works

- **Pointer events follow the DOM, not the pixels.** `pointer-events-none` on an element makes it (and, absent overrides, its subtree) transparent to hit-testing regardless of what's painted — an opaque gradient still lets clicks fall through to whatever is stacked beneath. The fix restores the invariant "if it's painted opaque, it intercepts" by giving every opaque region its own `pointer-events-auto` layer, while the genuinely transparent fade stays click-through so the text dissolving under it remains scrollable and selectable.
- **`scroll-padding` is the CSS mechanism designed exactly for in-scroller overlays.** It shrinks the scrollport's "optimal viewing region" that focus auto-scroll and `scrollIntoView` target, so the browser voluntarily keeps focused elements above the band. Nothing else in the platform tells focus-scrolling about a sticky child.

## Prevention

- **Whenever a sticky/floating overlay lives inside a scroll container, apply all three controls of the law by default** — scoped click-through, scroll-padding, and (when the overlay resizes) a pre-resize re-pin basis — rather than discovering them one review at a time.
- **Browser-verify with these two recipes (headless Chromium via the chrome-devtools MCP); jsdom cannot express either failure:**
  - **Hit-test:** evaluate `document.elementFromPoint(x, y)` at points over the band's opaque strip and side gutters — must resolve to the intercepting wrapper, never to underlying links/buttons; over the transparent fade it must reach the transcript text.
  - **Focus probe:** append a temporary link at the transcript end, `focus()` it, and compare its `getBoundingClientRect().bottom` to the band's top — the focused element must sit fully above the band.
- **Keep the scroll-padding sized to the overlay.** Since feat-270, the ResizeObserver sizes `scroll-padding-bottom` to the live band height at runtime (see "The third half of the law" below); the static `13rem` class is only the SSR resting default and must be re-sized only if the composer's RESTING height changes structurally.
- **Residual known limits (accepted, not regressions):** the composer card itself still overlays content when scrolled up (inherent to the overlay design). The other limit originally tracked here — textarea auto-grow (`apps/chat/src/components/chat/composer.tsx`, cap 200px) exceeding the fade buffer without re-pinning — was **closed by feat-270**: see "The third half of the law" below for the ResizeObserver fix AND the shrink-direction clamp bug it shipped through first.

## The third half of the law (feat-270): re-pin on overlay resize compares the PRE-resize distance

feat-270 closed the auto-grow residual above: the composer band (`chat.tsx:231-232`, `data-composer-band`) grows/shrinks with the draft, so a `ResizeObserver` effect (`chat.tsx:160-183`) now (a) sets `scroller.style.scrollPaddingBottom` to `band height + 8px` — keeping law #2's contract alive as the band's real height moves, with the static `[scroll-padding-bottom:13rem]` class (`chat.tsx:199`) remaining only as the SSR resting default — and (b) re-pins `scrollTop` to the bottom ONLY when the reader was already at/near the bottom. That second half carries the third control this doc hadn't named yet, and its first implementation got it wrong.

### The shipped-then-caught bug

```ts
// WRONG — first implementation
const distance =
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight // measured AFTER resize
if (distance - Math.max(delta, 0) <= NEAR_BOTTOM_PX) {
  scroller.scrollTop = scroller.scrollHeight
}
```

`delta = newBandHeight - prevBandHeight`; `NEAR_BOTTOM_PX = 64` (`chat.tsx:14`). The `Math.max(delta, 0)` clamp encoded the intuition "growth pushed `scrollHeight` up by `delta`, subtract it back; shrink needs no compensation." Wrong for shrink: with `delta < 0` the test degrades to the raw POST-shrink distance. The formula-attributable yank window is `|delta| < D <= 64 + |delta|` (pre-shrink distance `D`): those readers read `D - |delta| <= 64` and got re-pinned mid-read. Readers at `D <= |delta|` also end at the bottom, but by the browser's own `scrollTop` clamp — that happens under broken and fixed formulas alike (layout physics, not this bug). Concretely: sending a grown 8-line draft collapses the band ~156px, so the formula wrongly yanked anyone parked ~157–220px above the bottom.

### What didn't work

- **The directional clamp** — plausible-sounding but asymmetric: it compensates grow and leaves shrink uncompensated, which moves the measured distance TOWARD the threshold for exactly the readers who must not be re-pinned.
- **The manual browser no-yank probe at 300px up.** 300px sits outside the broken `(64, 64 + |delta|]` window (~`(64, 220]` here), so the probe exercised the same "clearly not near bottom" branch under both the broken and correct formulas — it passed while the bug shipped. jsdom is separately blind (no ResizeObserver, no layout).

### The fix (`chat.tsx:173-179`)

```ts
// Compare the PRE-resize distance from the bottom: the resize already
// moved scrollHeight by `delta` (both directions), so subtract it back.
const distance =
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
if (distance - delta <= NEAR_BOTTOM_PX) {
  scroller.scrollTop = scroller.scrollHeight
}
```

No clamp. The identity `distance_before = distance_after - delta` holds symmetrically because the band sits in the scroll content's normal flow, so `scrollHeight` changes by exactly `delta` in both directions. (Preconditions: the recovery is exact only while the scroller's `scrollHeight` is content-determined — in chat's `min-h-full` short-transcript regime the flex column absorbs band growth, so `scrollHeight` moves by LESS than `delta`, benign here because both error directions are safe — and while nothing else mutates `scrollTop` or content height in the same frame; the browser clamp below is handled, scroll anchoring and same-frame transcript growth are not.)

Clamp edge case: a reader within `|delta|` of the bottom before a shrink gets clamped to the bottom by the browser itself (`scrollTop` cannot exceed the new max), and the clamp breaks the identity — the formula then computes exactly `|delta|` as the "pre-resize distance," so it skips the explicit re-pin when `|delta| > NEAR_BOTTOM_PX` and redundantly re-pins when `|delta| <= NEAR_BOTTOM_PX`. Harmless in both branches: the scroller is already at the bottom.

Verified across all four cases in headless Chromium — grow at bottom → re-pins; grow while scrolled up → no yank; shrink at bottom → browser-clamp no-op; shrink while scrolled up → no yank — with the scrolled-up shrink probe at 180px, inside the formula-attributable `(156, 220]` band (`scrollTop` 1691 → 1691, unchanged).

### Prevention (third-control specific)

- **The discriminating probe position for a near-bottom threshold is INSIDE `(max(threshold, |delta|), threshold + |delta|]`** — an arbitrary "scrolled up" position proves nothing, and each resize direction needs its own probe inside its own window. On shrink, positions at or below `|delta|` are non-discriminating: the browser's `scrollTop` clamp lands the reader at the bottom under broken and fixed formulas alike.
- **Encode the invariant, not a direction-specific patch:** when a threshold decision means "was the reader already at X" and the layout is about to change, recover the pre-change value (`after - delta`) — never reason from the post-change number with a clamp bolted on.
- **The re-pin DECISION is pure arithmetic and IS unit-testable** — jsdom-blindness covers the layout, hit-testing, and ResizeObserver plumbing, not the algebra. Extract the decision as a pure function of `(distanceAfter, delta, threshold)` and table-test it across both directions including the boundary cases (`threshold`, `threshold + |delta|`, the clamp band): `distanceAfter=50, delta=-156` discriminates the broken clamp from the fix with no browser at all. Keep the browser probe for the observer-arming seam, per the feat-262 caveat in `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.
- This bug was caught by adversarial code review reasoning through the algebra (then independently re-derived by a validator), not by a browser run — for jsdom-invisible layout logic, tracing the formula against BOTH directions catches what an under-scoped browser probe misses.

## Related Issues

- feat-267 (chat UI quick wins) — shipped the restructure and the first two fixes via [PR #1617](https://github.com/JesusFilm/forge/pull/1617), merged.
- `docs/roadmap/ai-chat/feat-270-chat-ui-cleanup-batch.md` — item 7 is the origin of the third control above; its fix is uncommitted on `feat/chat-ui-cleanup-batch` and ships with feat-270's pending PR, unmerged as of this writing.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META pattern this instantiates: green unit suites prove code shape, not production (here: browser) contract.
- `docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md` — sibling browser-verification gotcha for apps/web dialogs.
- `docs/solutions/ui-bugs/firefox-backdrop-filter-sticky-hero-scroll-fallback.md` — adjacent sticky+scroll rendering bug (Firefox compositing), same browser-only-detection family.
