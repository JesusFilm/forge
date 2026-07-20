---
title: "Sticky overlay inside a scroll container needs transparent-zone-scoped click-through AND scroll-padding"
date: "2026-07-15"
category: ui-bugs
module: apps/chat
problem_type: ui_bug
component: chat-composer
symptoms:
  - "Clicks over the opaque bottom strip and side gutters of the sticky composer overlay pass through to invisible transcript content (source links, Retry/Start-new buttons) scrolled beneath it"
  - "Tab-focusing a below-fold transcript link auto-scrolls it behind the sticky composer overlay instead of into view, hiding the new :focus-visible outline too"
  - "A green 418-test jsdom suite shipped both defects — jsdom does not model hit-testing geometry or focus-driven scroll behavior"
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
  - "focus"
  - "css"
  - "chat"
  - "jsdom-limits"
  - "elementFromPoint"
---

# Sticky overlay inside a scroll container: scope click-through to transparent zones and add scroll-padding — neither is testable in jsdom

**The general law:** a sticky/floating overlay placed INSIDE a scroll container needs BOTH of these, every time:

1. **Click-through (`pointer-events-none`) scoped strictly to the overlay's transparent zones.** Every fully-opaque region of the overlay band (solid gradient strip, side gutters, the card itself) must intercept pointer events — otherwise invisible content scrolled beneath the opaque region still receives clicks.
2. **`scroll-padding-bottom` on the scroll container, sized to the overlay's height.** Browser focus auto-scroll (and `scrollIntoView`) targets the scrollport edge and knows nothing about overlays inside the scroller — without scroll-padding, Tab parks focused elements exactly behind the band: focused but invisible.

And neither failure is observable in jsdom. Both shipped through typecheck, lint, and a green 418-test unit suite; only browser-driven verification (`document.elementFromPoint` hit-testing and a focus-probe rect comparison) caught them.

## Problem

apps/chat's conversation pane (`apps/chat/src/components/chat/chat.tsx`) was restructured so the composer is a `sticky bottom-0` overlay INSIDE the `overflow-y-auto` scroller, wrapped in a `min-h-full` flex column (transcript `flex-1`) so it stays pinned when content is short, with a `bg-gradient-to-b` "protection fade" and pointer-events layering (chat.tsx:132-190; uncommitted in the working tree — unmerged as of this writing, ships with the pending PR for feat-267).

The restructure fixed a real bug: previously the composer was a flex SIBLING of the scroller, so the scrollport ended at the composer wrapper's `pt-16` padding — the transcript clipped ~100px above the composer, and the fade gradient faded over its own empty padding, never over text. The before shape (still on `main`):

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

Current tree, `apps/chat/src/components/chat/chat.tsx` (pending PR for feat-267):

**Fix 1 — split the pointer-events layers (chat.tsx:169-171).** `pointer-events-none` stays on the outer sticky wrapper, which now carries ONLY the transparent `pt-16` fade; a full-width `pointer-events-auto` inner div carries the `px-8 pb-8` (the opaque strip and gutters) and intercepts everything over the opaque zone:

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

**Fix 2 — scroll-padding on the scroller (chat.tsx:136-139).**

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

- **Whenever a sticky/floating overlay lives inside a scroll container, apply both halves of the law by default** — scoped click-through plus scroll-padding — rather than discovering them one review at a time.
- **Browser-verify with these two recipes (headless Chromium via the chrome-devtools MCP); jsdom cannot express either failure:**
  - **Hit-test:** evaluate `document.elementFromPoint(x, y)` at points over the band's opaque strip and side gutters — must resolve to the intercepting wrapper, never to underlying links/buttons; over the transparent fade it must reach the transcript text.
  - **Focus probe:** append a temporary link at the transcript end, `focus()` it, and compare its `getBoundingClientRect().bottom` to the band's top — the focused element must sit fully above the band.
- **Keep the scroll-padding sized to the overlay.** The `13rem` value must be re-sized if the composer grows structurally.
- **Residual known limits (accepted, not regressions):** the composer card itself still overlays content when scrolled up (inherent to the overlay design); the textarea auto-grow (`apps/chat/src/components/chat/composer.tsx:33-38`, cap 200px) can exceed the fade buffer without re-pinning — accepted and tracked in feat-270's scope.

## Related Issues

- Pending PR for feat-267 (chat UI quick wins) — ships the restructure and both fixes; unmerged as of this writing.
- `docs/roadmap/ai-chat/feat-270-chat-ui-cleanup-batch.md` — tracks the auto-grow-vs-fade-buffer residual.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META pattern this instantiates: green unit suites prove code shape, not production (here: browser) contract.
- `docs/solutions/best-practices/base-ui-dialog-state-attribute-detection-20260520.md` — sibling browser-verification gotcha for apps/web dialogs.
- `docs/solutions/ui-bugs/firefox-backdrop-filter-sticky-hero-scroll-fallback.md` — adjacent sticky+scroll rendering bug (Firefox compositing), same browser-only-detection family.
