---
title: React Compiler (R19) — six patterns for satisfying refs / immutability / set-state-in-effect
date: 2026-05-13
category: docs/solutions/design-patterns
module: apps/web
problem_type: design_pattern
component: tooling
severity: high
applies_when:
  - Writing or editing any React 19 component in apps/web (Next.js + eslint-config-next/core-web-vitals)
  - Mutating a value imported from useState — should be a useRef instead
  - Reading or writing ref.current during render — needs an effect or a local-state mirror
  - Calling setState in the synchronous body of a useEffect — needs derived state or an async continuation
  - Tempted to reach for eslint-disable-next-line react-hooks/* — try restructuring first
related_components:
  - development_workflow
  - testing_framework
tags:
  - react-19
  - react-compiler
  - eslint
  - hooks
  - useref
  - useeffect
  - lint-staged
  - apps-web
---

# React Compiler (R19) — six patterns for satisfying refs / immutability / set-state-in-effect

## Context

React 19's compiler ships three new hook-lint rules — `react-hooks/refs`, `react-hooks/immutability`, `react-hooks/set-state-in-effect` — that treat `useState` returns as immutable, forbid render-phase ref reads/writes, and reject most setState calls inside `useEffect`. Code that was idiomatic under React 18 now fails lint.

The trap that bit PR #936 (six errors across four files): the forge **root** `eslint.config.mjs` only registers `eslint-plugin-react-hooks` for `apps/manager/**` and `apps/admin/**`, so `lint-staged` (which runs the root config) never sees these rules for `apps/web`. The **package-level** lint (`pnpm --filter @forge/web lint`) pulls in `eslint-config-next/core-web-vitals`, which adds them — and that's what CI runs. The errors pass pre-commit and fail CI. Worse, `eslint-disable-next-line react-hooks/set-state-in-effect` breaks pre-commit ("rule not found"), so the durable fix has to be structural.

## Guidance

Six patterns covering the three new rules. Each is a structural rewrite, not a disable comment.

### Pattern 1 — Read mutable values via refs, not useState aliases

`useState` returns are immutable to the compiler. Mutating a property on a state-held object trips `react-hooks/immutability`. If you need to mutate (mux-player flags, video element controls), keep a `useRef` alongside the state and mutate through the ref.

```ts
// BEFORE — flagged: "This value cannot be modified"
useEffect(() => {
  if (!player) return
  player.muted = false
}, [player])

// AFTER — read through the ref (mutable); state stays in deps so the
// effect re-runs when the player attaches.
useEffect(() => {
  const livePlayer = playerRef.current
  if (!livePlayer) return
  livePlayer.muted = false
}, [player, playerRef])
```

### Pattern 2 — Move render-phase ref writes into useEffect

Writing `someRef.current = X` inside an `if` during render is rejected by `react-hooks/refs`. Move the write into an effect keyed on the trigger.

```ts
// BEFORE — render-phase ref write inside the prev/current snapshot block
if (prev !== current) {
  setPrev(current)
  autoplayAttemptedRef.current = false
}

// AFTER
useEffect(() => {
  autoplayAttemptedRef.current = false
}, [current])
```

### Pattern 3 — Async-continuation wrap for setState after possibly-sync calls

setState inside an effect's synchronous branch trips `set-state-in-effect`. When the call site is "maybe sync, maybe async" (e.g. mux-player's `play()` returns a Promise on modern shims and undefined on legacy ones), wrap with `Promise.resolve(...)` so the setStates always land in `.then`.

```ts
// BEFORE — sync else-branch sets state
const result = livePlayer.play()
if (result?.then) {
  result.then(() => setChromeRevealed(true)).catch(() => {})
} else {
  setChromeRevealed(true) // flagged
}

// AFTER — always async continuation
Promise.resolve(livePlayer.play())
  .then(() => {
    setChromeRevealed(true)
    setAutoplayBlocked(false)
  })
  .catch(() => {})
```

### Pattern 4 — Mirror a ref into state for render-time reads

Reading `someRef.current` in render is rejected. Mirror the ref into state via a mount-effect — refs assigned by parents commit before child effects run, so the mirror lands on first paint.

```ts
// BEFORE — render-time ref read
return createPortal(chrome, isFullscreen ? wrapperRef.current : overlayAnchor)

// AFTER
const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null)
useEffect(() => {
  setWrapperEl(wrapperRef.current)
}, [wrapperRef])

return createPortal(chrome, isFullscreen ? wrapperEl : overlayAnchor)
```

### Pattern 5 — Render-phase snapshot for prop-derived resets

The classic "reset internal state when a prop changes" effect now trips `set-state-in-effect`. React's documented replacement: compare during render and setState directly — the update queues into the same commit, no cascade.

```ts
// BEFORE
useEffect(() => {
  if (open) {
    setActiveIndex(0)
    setQuery("")
  }
}, [open])

// AFTER — render-phase snapshot
const [prevOpen, setPrevOpen] = useState(open)
if (prevOpen !== open) {
  setPrevOpen(open)
  if (open) {
    setActiveIndex(0)
    setQuery("")
  }
}
```

### Pattern 6a — Mutate interior properties on ref payloads, not `.current`

Once a ref is also written from a `useEffect`, reassigning `someRef.current` is flagged. Wrap the payload in an object and mutate its properties — `.current` keeps pointing at the same object, so the rule is satisfied. Useful for synchronous double-click guards and other ref-backed flags that need both effect writes and event-handler writes.

```ts
// BEFORE — reassigns .current
const inFlightRef = useRef(false)
inFlightRef.current = true // flagged once another effect writes inFlightRef.current

// AFTER — interior mutation
const guardRef = useRef<{ inFlight: boolean }>({ inFlight: false })
guardRef.current.inFlight = true
```

### Pattern 6b — Derive state from observable inputs instead of setState-in-effect

The "did the URL/external system catch up?" pattern — a useEffect that watches a prop and clears a local flag — is exactly what `set-state-in-effect` rejects. Derive the flag from a state field that already encodes the target.

```ts
// BEFORE
const [navigating, setNavigating] = useState(false)
useEffect(() => {
  if (navigating && currentLanguageSlug === draftSlug) {
    setNavigating(false)
  }
}, [navigating, currentLanguageSlug, draftSlug])

// AFTER — `navigating` is derived from a state that encodes the target
const [pendingNavTo, setPendingNavTo] = useState<string | null>(null)
const navigating = pendingNavTo !== null && currentLanguageSlug !== pendingNavTo

// On click:
setPendingNavTo(targetSlug)
router.push(buildUrl(targetSlug))
// When the URL catches up, `navigating` flips false on its own.
```

## Why This Matters

Two things compound.

**One**: every new React 19 component in `apps/web` will hit some subset of these six shapes. Having canonical rewrites means the next author reaches for a structural fix instead of an `eslint-disable` — which doesn't work anyway (see Context).

**Two**: the lint-config asymmetry is a structural risk. `lint-staged` and CI lint with different rule sets, so any rule scoped to the `apps/web` package config slips the pre-commit gate. Until the root config registers `eslint-plugin-react-hooks` for `apps/web/**`, contributors will keep landing PRs that fail CI on rules pre-commit never checked. Worth widening the root config or wiring the package-level lint into `lint-staged` for web files.

## When to Apply

- Authoring or modifying any React component in `apps/web/` (Next 16, React 19)
- Touching `useEffect`, `useRef`, or `useState` — the new rules cover the full hook surface
- Seeing CI fail with `react-hooks/refs`, `react-hooks/immutability`, or `react-hooks/set-state-in-effect` after a green pre-commit
- Tempted to add `eslint-disable-next-line react-hooks/*` — it breaks pre-commit because the root config doesn't know the rule; restructure instead

Does NOT apply to `apps/mobile/` (Expo, separate ESLint config), `apps/manager/`, or `apps/admin/` until they upgrade to the React Compiler ruleset.

## Examples

All from commit `8ae5a70a` in PR #936, across `apps/web/src/components/watch/`.

**HeroPlayer.tsx — Patterns 1 + 2 + 3.** Player mutation routed through `playerRef.current`; variant-scope autoplay reset moved to a useEffect; `play()` wrapped in `Promise.resolve` so the post-play setStates run as an async continuation.

```ts
const autoplayAttemptedRef = useRef(false)

useEffect(() => {
  autoplayAttemptedRef.current = false
}, [variant.documentId])

useEffect(() => {
  if (!videoReady) return
  const livePlayer = playerRef.current
  if (!livePlayer) return
  if (autoplayAttemptedRef.current) return
  if (autoplayParam !== "1") return
  autoplayAttemptedRef.current = true

  Promise.resolve(livePlayer.play())
    .then(() => {
      const settledPlayer = playerRef.current
      if (settledPlayer) settledPlayer.muted = false
      setChromeRevealed(true)
      setAutoplayBlocked(false)
    })
    .catch(() => {})
}, [player, videoReady, autoplayParam, playerRef])
```

**HeroPlayerControls.tsx — Pattern 4.** Portal target swap reads wrapper from local state, not from the ref directly.

```ts
const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null)
useEffect(() => {
  setWrapperEl(wrapperRef.current)
}, [wrapperRef])

// In render:
const target = isFullscreen ? wrapperEl : overlayAnchor
if (target == null) return null
return createPortal(chrome, target)
```

**LanguageCombobox.tsx — Patterns 2 + 5.** Filtered-list ref sync moved into a useEffect; open-transition reset converted to render-phase snapshot.

```ts
const filteredRef = useRef(filtered)
useEffect(() => {
  filteredRef.current = filtered
}, [filtered])

const [prevOpen, setPrevOpen] = useState(open)
if (prevOpen !== open) {
  setPrevOpen(open)
  if (open) {
    setActiveIndex(0)
    setQuery("")
  }
}
useEffect(() => {
  if (open) searchRef.current?.focus()
}, [open])
```

**LanguagePickerModal.tsx — Patterns 6a + 6b.** Sync double-click guard wrapped in an object payload (interior mutation); `navigating` derived from `pendingNavTo` instead of cleared by an effect. TDZ also fixed by declaring the ref + state before the open-reset effect that references them.

```ts
// Order matters: declare BEFORE the effect that references these.
const navigatingRef = useRef<{ inFlight: boolean }>({ inFlight: false })
const [pendingNavTo, setPendingNavTo] = useState<string | null>(null)

useEffect(() => {
  if (open) {
    setDraftSlug(currentLanguageSlugLatestRef.current)
    navigatingRef.current.inFlight = false
    setPendingNavTo(null)
  }
}, [open])

const navigating = pendingNavTo !== null && currentLanguageSlug !== pendingNavTo

const handleApply = useCallback(() => {
  if (!isDirty) return
  if (navigatingRef.current.inFlight) return
  navigatingRef.current.inFlight = true
  setPendingNavTo(draftSlug)
  router.push(buildHref(draftSlug))
}, [draftSlug, isDirty, router])
```

## Related

- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md` — touches Pattern 5 (render-phase state reset) in passing
- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` — adjacent ref-vs-state patterns on RNtvOS
- PR #936 — full diff with all six patterns applied; commit `8ae5a70a` is the lint-fix landing
