---
module: apps/chat
date: "2026-06-24"
problem_type: tooling_decision
component: tooling
severity: medium
applies_when: Hand-writing a CSS transition property list (Tailwind arbitrary value like transition-[...] or raw transition-property) that animates a Tailwind v4 transform-family utility — translate-*, scale-*, or rotate-* — e.g. slide-in drawers, off-canvas panels, scaling toasts.
tags:
  - tailwind
  - tailwind-v4
  - css-transition
  - translate
  - transform
  - animation
  - drawer
  - frontend
---

# Tailwind v4 splits `transform` into four properties — arbitrary `transition-[transform]` no longer covers `translate`/`scale`/`rotate`

Verified against Tailwind **v4.1.18** (pinned in `apps/chat/package.json`) and
**v4.2.4** (resolved in the lockfile) — identical behavior, so this is a stable
v4 design, not a patch-level quirk.

## Context

Building a mobile off-canvas drawer in `apps/chat`, the element had
`transition-[width,transform] duration-300` and toggled between
`-translate-x-full` and `translate-x-0`. It looked right but the drawer **popped
in instantly with no slide** — the scrim faded (its `transition-opacity` worked)
while the panel jumped.

## Guidance

Tailwind v4's CSS-first rewrite adopts the CSS individual-transform properties:
`transform`, `translate`, `scale`, and `rotate` are now **four independent
properties**. `translate-x-*` emits `translate: …` (not `transform: translateX(…)`
as in v3); `scale-*` emits `scale: …`; 2D `rotate-*` emits `rotate: …`.

The consequence is **only** about how you spell the transition:

- The **named** `transition-transform` utility is **safe** — v4 expands it to
  `transition-property: transform, translate, scale, rotate`, so it animates all
  four. (This was _not_ the bug.)
- A **hand-written** property list that names only `transform` is **not** safe —
  it misses the three siblings. That was the actual bug here: the arbitrary
  value `transition-[width,transform]` lists the literal `transform` property,
  which no longer changes when `translate-*` does.

Fix — name every transform-family property you actually animate (here, just
`translate`):

```diff
- "transition-[width,transform] duration-300 ease-[var(--ease-vigil)]"
+ "transition-[width,translate] duration-300 ease-[var(--ease-vigil)]"
```

(`ease-[var(--ease-vigil)]` is a project-local easing token — incidental;
substitute any easing. The load-bearing change is `transform` → `translate`.)

**If the element also animates `scale-*` or `rotate-*`,** list those too
(`transition-[width,translate,scale,rotate]`) — or, when you don't need to
combine with a non-transform property like `width`, just use the named
`transition-transform`, which already covers all four.

**Exceptions that still live on `transform`:** `skew-*` and 3D
`rotate-x-*`/`rotate-y-*`/`rotate-z-*` still emit the `transform` property — for
those, `transition-transform` (or arbitrary `transition-[transform]`) is
correct. The rule is "name the property Tailwind actually emits," not "always
avoid `transform`."

## Why This Matters

It is a **silent** failure — no console warning, no type/lint error, tests pass
(jsdom has no layout/transitions). The motion just doesn't happen. It also bites
in the **v3 → v4 upgrade direction**: an existing `transition-[...,transform]`
(or raw `transition-property: transform`) on a `translate-*` element silently
stops animating after the upgrade, with no error to trace it back to.

## When to Apply

Any Tailwind **v4** element where you hand-list transition properties and a
transform-family utility (`translate`/`scale`/`rotate`) changes.

Verify two ways:

- **Compiler (authoritative, version-checkable):** inspect the generated CSS —
  `-translate-x-full` emits `translate: …`, and `.transition-transform` emits
  `transition-property: transform, translate, scale, rotate`.
- **Browser:** select the element and sample the animated property in flight,
  e.g. `getComputedStyle(document.querySelector('aside')).translate` across the
  duration. Intermediate values (`-100% → -42% → 0px`) confirm it animates; a
  single jump confirms it doesn't. (Note: a browser sample alone can't tell you
  _which_ spelling is at fault — the compiler check does.)

## Examples

Confirmed in the browser after the fix — `translate` interpolated smoothly
(`-100% → -78% → -42% → -15% → -3% → 0` over ~300ms with the easing curve)
instead of jumping straight to `0`.

## Related gotcha (same drawer)

The collapse animation used a clip flag cleared on the aside's
`onTransitionEnd` (filtered `propertyName === "width"`). Two things to know:

- **`transitionend` is not guaranteed to fire** — globally-disabled transitions,
  zero-delta, or an interrupted animation can skip it, which latches the derived
  state. Pair it with a fallback `setTimeout` (~50ms past the CSS duration, so
  ~350ms for a 300ms transition), started in the same handler that starts the
  transition. Make the cleanup **idempotent** (or `clearTimeout` inside the
  `transitionend` handler), since the timer and the event can both fire.
- **`transitionend` fires once per animated property,** so the `propertyName`
  filter is required — and it must track whichever property you key on if the
  transition list changes.
- **State-update placement:** set the flag synchronously in the event handler
  that starts the animation, not in a `useEffect` body — a synchronous `setState`
  at the top of an effect risks an effect→render→effect cycle (`react-hooks/
set-state-in-effect` flags exactly this). The fallback's `setState` lives
  inside the `setTimeout` callback, which is asynchronous and therefore fine.
