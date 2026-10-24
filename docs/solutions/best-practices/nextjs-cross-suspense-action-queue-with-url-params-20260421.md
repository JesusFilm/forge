---
title: "Queueing a user action across a Suspense boundary re-key in Next.js App Router"
date: "2026-04-21"
category: best-practices
module: apps/web
problem_type: ui_bug
component: web
severity: medium
root_cause: framework_misuse
resolution_type: code_fix
related_components:
  - apps/web/src/app/demo-search/page.tsx
  - apps/web/src/components/demo-search/AiExperienceGeneratorDemo.tsx
  - apps/web/src/components/demo-search/DemoSearchInput.tsx
  - apps/web/src/components/demo-search/GenerateShortcutButton.tsx
  - apps/web/src/components/search/SearchInput.tsx
  - apps/web/src/lib/demo-generate-bus.ts
github_prs:
  - "#815"
  - "#816"
  - "#817"
related_docs:
  - "docs/solutions/ui-bugs/react-duplicate-sibling-keys-append-on-rerender-20260421.md"
  - "docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md"
tags:
  - react
  - nextjs
  - app-router
  - suspense
  - react-strict-mode
  - client-state
  - url-params
  - usesync-external-store
  - demo-search
---

# Queueing a user action across a Suspense boundary re-key in Next.js App Router

## Problem

`/demo-search` has a hero-bar search input and two "Generate" buttons (a shortcut next to the input, plus one inside a downstream `AiExperienceGeneratorDemo` component). The AI component sits inside a Suspense boundary keyed by the current query — `<Suspense key={query} fallback={skeleton}>` — so every query change unmounts it and re-renders the skeleton while the new RSC streams in.

Two UX asks that look trivial but fight the framework:

1. **"Enter + Generate should auto-regenerate."** User types a new query, presses Enter. URL updates, search refetches, skeleton shows, new cards arrive, _and_ the AI preview should generate against the new results — without a second click.
2. **"Click during loading should queue."** User clicks Generate while the Suspense fallback is showing. The AI component is unmounted at that instant. Button should immediately show "Waiting for search to finish…", and once the component mounts, the generation should fire automatically.

Both require a signal to cross a Suspense boundary re-key, which tears down the subscriber before the new one exists.

## Symptoms

- Enter + type a query: results update, AI preview stays on the old result. User has to click Generate again.
- Click Generate mid-fallback: button does nothing. No network activity. No "loading" feedback.
- After a fix attempt via a module-level bus with `queueMicrotask` + TTL: intermittent, reliable-looking in prod but silent in dev under React Strict Mode (the double-invocation of `useEffect` consumed the queued trigger on the first invocation, leaving the second real listener empty).

## What Didn't Work

1. **Firing existing bus subscribers at the moment of Enter.** The old component is still mounted when `router.replace` kicks off, so it catches the fire, starts a fetch closure-captured to the **old** query, and then gets unmounted mid-flight. The request is orphaned; the new component never sees the intent.

2. **Module-level `queuedTriggerAt` + `queueMicrotask` on subscribe.** Mechanically sound but React Strict Mode's dev-only double-invocation of effects means the **first** subscribe consumes the queue and schedules the microtask against a listener that is immediately torn down by strict-mode cleanup; the **second** (real) subscribe sees an empty queue. Works in prod, broken in dev — a trap that shows up only when someone else debugs locally. Reject.

3. **Making the button "disabled" during search.** Blocks the "queue on click" intent entirely. User sees a dead button with no feedback.

4. **Relying on a single `generatePending` flag.** Conflates "generation is queued / UI wants to show a spinner" with "fetch is in flight". Breaks when the queued state needs to survive an unmount (the local `isPending` is gone but the bus still needs to say "Waiting…").

## Solution

Three cooperating mechanisms, layered by durability:

### 1. URL param as the cross-Suspense trigger (Enter-key path)

The Enter-key handler appends `?ag=1` to the navigation URL. On the _next_ mount — regardless of Strict Mode double-invocation, hydration races, or React 19 streaming order — the new `AiExperienceGeneratorDemo` reads `useSearchParams().get("ag")`, auto-fires its generation, and strips the param via `history.replaceState` (silent, no RSC round-trip, so reloading won't re-fire).

```tsx
// AiExperienceGeneratorDemo.tsx
const searchParams = useSearchParams()
const shouldAutogen = searchParams.get(AUTOGEN_QUERY_PARAM) === "1"
const autogenFiredRef = useRef(false)

useEffect(() => {
  if (autogenFiredRef.current) return
  const queued = getGeneratePending()
  if (!shouldAutogen && !queued) return
  autogenFiredRef.current = true
  if (shouldAutogen && typeof window !== "undefined") {
    const url = new URL(window.location.href)
    url.searchParams.delete(AUTOGEN_QUERY_PARAM)
    window.history.replaceState(null, "", url.toString())
  }
  runRef.current()
}, [shouldAutogen])
```

The `autogenFiredRef` is the Strict-Mode defense: refs survive the double-invocation, so the first effect commit can set `fired=true` and the second is a no-op.

### 2. Module-level "pending" flag for the click-during-loading path

Clicking Generate while the subscriber is unmounted can't use the pub/sub listener path — there's nothing to fire. Instead we have a second, simpler channel: a shared `generatePending` boolean. Clicking while `searchPending` is true just _raises the flag_. The autogen effect above checks both `?ag=1` **and** `getGeneratePending()`, so a click-queue picks the trigger up on the next mount.

```tsx
// GenerateShortcutButton.tsx
function handleClick() {
  if (searching) {
    setGeneratePending(true) // queue; no-op otherwise
    return
  }
  requestGenerate() // fires live subscriber
}
```

Unlike the microtask-queue approach, this has no "when was it queued / has TTL expired" logic — the component either mounts and finds the flag raised, or it doesn't. Deterministic.

### 3. `onBeforeNavigate` hook so typing + Enter behave identically

The original `SearchInput` fired its parent callback (`onSubmit`) only on Enter. Typing triggered a 300 ms-debounced `router.replace` that set **nothing** — so the shortcut button during typed-query loading still read "Generate", clicking it took the wrong branch (saw `searching=false`), and the click silently no-op'd.

Fixed with a new `onBeforeNavigate?: () => void` prop fired synchronously in _both_ the Enter handler and the debounced navigator. `DemoSearchInput` wires it to `setSearchPending(true)` so the button label is correct no matter how navigation was triggered.

```tsx
// SearchInput.tsx (excerpt)
timerRef.current = setTimeout(() => {
  onBeforeNavigate?.()
  router.replace(...)
}, 300)

// later, Enter path:
onBeforeNavigate?.()
router.replace(...)
onSubmit?.()
```

### 4. Two orthogonal pending flags, not one

Split the UI state cleanly:

| Flag              | Semantic                       | Raised by                                                         | Cleared by                                  |
| ----------------- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------- |
| `searchPending`   | RSC nav in flight              | `onBeforeNavigate` (typing + Enter)                               | `AiExperienceGeneratorDemo` mount useEffect |
| `generatePending` | Generation queued or in flight | `onSubmit` (Enter), `handleClick` during search, or `run()` start | `run()` finally block                       |

Button labels derive from both:

```
pending=false, searching=?     → "Generate"                (clickable)
pending=true,  searching=true  → "Waiting for search to finish…" (disabled)
pending=true,  searching=false → "Composing…"              (disabled)
```

## Why This Works

**URL params survive Strict Mode.** React Strict Mode's effect double-invocation is designed to trip up any cleanup that assumes single-run. Module-level state that gets consumed in an effect is a direct hit. URL state is part of the render environment, not the effect lifecycle, so it's read fresh on every mount.

**`history.replaceState` strips without re-render.** `router.replace` would start a fresh RSC navigation, causing a render loop. `history.replaceState` only mutates `window.location` + browser history — no React, no Next router, no RSC fetch. Exactly what "silent URL cleanup" needs.

**Refs are the Strict-Mode escape hatch.** `useRef` survives double-invocation because it's not part of the render value. Any "did we already consume this intent" check belongs in a ref, not in module-level state and not in `useState`.

**Two pending flags separate responsibility.** `searchPending` is owned by the nav layer (`SearchInput` → bus). `generatePending` is owned by the generation layer (button click + autogen effect + run). Combining them into one flag forces one subsystem to know about the other's lifecycle.

**Clickable-while-busy with a queued intent** is the right UX primitive for "I want to do X when the thing blocking X finishes." Disabling the button would force users to wait-watch-click; queueing lets them fire-and-forget. The key is that the queued intent must be _durable across the unmount that ends the blocking state_ — hence the shared flag rather than component-local state.

## Prevention

**When a UI intent must cross a Suspense boundary re-key, don't use pub/sub.** The subscriber count is 0 at exactly the moment you need it to be >0. Options in order of robustness:

1. **URL query param + `useSearchParams` + `history.replaceState`** — best for "one-shot, ship-and-forget" intents like "auto-run on next mount."
2. **Shared module-level flag + ref-guarded mount effect** — good for stateless queued intents. Guard with `useRef`, not `useState`, so Strict Mode doesn't consume it twice.
3. **Pub/sub `queueMicrotask`** — **avoid**. Looks clean, breaks silently under Strict Mode.

**Test dev flows in Strict Mode before shipping.** React Strict Mode is on by default in Next.js and is the truth bar. A module-level queue that works in prod builds but fails in `next dev` is a broken queue — the prod behavior just happens to hide the bug.

**Diagnose with headless Chromium against `localhost`.** Every theory in this investigation was wrong until I ran `puppeteer-core` against `localhost:3000`, clicked the button, and observed the mutation sequence. One real DOM assertion is worth ten correct-sounding hypotheses.

**Check button-enabled semantics during async transitions.** If the button exists during the loading state, it should be clickable — either to fire immediately or to queue. A disabled button during loading tells the user "go away," which is almost never what you want.

**`onBeforeNavigate` is a reusable pattern for any search-as-you-type UI.** If the parent needs to flip a "navigating…" flag, firing it on debounced-typing as well as Enter keeps the UI consistent regardless of how the user triggered it.

## Related Documentation

- [React duplicate sibling keys append on re-render](../ui-bugs/react-duplicate-sibling-keys-append-on-rerender-20260421.md) — the prior bug in this same component tree. Lesson: investigate with headless Chromium, not theory.
- [Next.js Server Action + LLM structured output pattern](nextjs-server-action-llm-structured-output-pattern-2026-04-21.md) — the underlying generation primitive this UI wraps.
- PR #815 — duplicate-key fix.
- PR #816 — metrics reset on page refresh.
- PR #817 — Enter + queue-on-click + two-flag loading states.
