---
title: "Per-message error boundaries do not contain a failed chunk load"
date: "2026-08-04"
category: "best-practices"
problem_type: "best_practice"
module: "apps/chat"
component: "video-card"
resolution_type: "documentation"
severity: "medium"
root_cause: "incorrect_assumption"
tags:
  - "error-boundary"
  - "next-dynamic"
  - "react-lazy"
  - "turbopack"
  - "code-splitting"
  - "media"
  - "chat"
  - "containment"
  - "line-clamp"
  - "css"
  - "jsdom"
applies_when:
  - "Adding a lazily-loaded media surface (player, image, iframe) to a per-message or per-item render"
  - "Claiming that an error boundary contains a failure to one item"
  - "Reaching for a userland retry around a dynamic import()"
  - "The only bound on untrusted display text is CSS (line-clamp-*), which jsdom cannot observe"
---

# Per-message error boundaries do not contain a failed chunk load

## Context

feat-268 established chat's per-message containment law: assistant turns render
untrusted markdown behind `MarkdownRenderBoundary`, so a pathological input
degrades ONE turn instead of unmounting a tree that has no app-level boundary.

feat-328 added an inline Mux video player as a sibling block on the same turns,
lazily loaded through `next/dynamic(..., { ssr: false })`, and copied that law:
a `VideoRenderBoundary` per card, with the code comment, the package CLAUDE.md,
and the plan all stating that a failure "degrades that ONE turn."

That claim is true for two of the three failure classes a lazy media surface
has, and false for the third. Two review rounds repeated it before the third
caught it.

## Guidance

**A per-message boundary contains a RENDER throw. It does not contain a failed
chunk load, and on a Turbopack build no import-layer retry can rescue one.**

### 1. Name BOTH cache layers, not just React's

A rejected dynamic import is cached in two independent places:

- **React.lazy's payload**, which `next/dynamic` wraps. Module-scoped, so every
  card shares it.
- **The bundler's emitted runtime.** In Turbopack's `loadChunkCached`, a
  per-chunk record returns its stored promise whenever `loadingStarted` is set;
  nothing resets that flag, and the emitted runtime contains zero eviction calls
  of EITHER form (`delete` operator or `Map.prototype.delete` — records live in
  a Map, so checking only the operator gives a false all-clear).

Naming both is load-bearing, not pedantry. With only the React layer in view,
two wrong fixes look right: "give each card its own lazy instance" and "remount
with a key." Both are inert against the runtime cache underneath. State the
lower layer or the next reader will re-derive the wrong remedy.

### 2. A userland retry around `import()` is inert — verify at the emitted layer

The obvious mitigation is a retry wrapper:

```ts
// INERT on a Turbopack build. Attempts 2 and 3 receive the SAME settled
// rejection from the cached chunk record; the only effect is ~900ms of delay
// before the identical fallback.
function loadMuxVideo(attempt = 0): Promise<typeof import("./player")> {
  return import("./player").catch((error) => {
    if (attempt >= 2) throw error
    return delay(300 * (attempt + 1)).then(() => loadMuxVideo(attempt + 1))
  })
}
```

This one shipped into a working tree and survived a review round on plausibility
alone. It was deleted only after someone read the built runtime.

**Webpack behaves differently** — `JsonpChunkLoadingRuntimeModule` emits
`installedChunks[chunkId] = undefined` inside the `loadingEnded` handler that
sets `error.name = "ChunkLoadError"`, so the record IS evicted and a bounded
retry genuinely works there. That difference is the whole point:
**retry-effectiveness is an empirical mechanism claim, verified per app, per
bundler, at its own layer.** Read `.next/static/chunks/turbopack-*.js` (or the
webpack equivalent). Never reason from intuition about the other one.

> Stamp both halves, not just the one you ran. Turbopack: verified 2026-08-04
> by reading this repo's built runtime chunk (`next@16.2.4`). Webpack: verified
> 2026-08-04 by reading `webpack@5.106.2`
> `lib/web/JsonpChunkLoadingRuntimeModule.js:189` — **source-derived, not
> observed on a running webpack build** (webpack is a transitive dependency
> here and never builds `apps/chat`). An unstamped mechanism claim replicated
> across several files is the feat-306 trap this repo already documents.

### 3. Media `error` events bypass boundaries entirely

React error boundaries catch render-phase and lifecycle throws. A failed
decode, a 404 asset, a geo-block, or a mid-stream network drop surfaces as a
native `error` EVENT on the media element — outside render, so
`getDerivedStateFromError` never sees it. Without an explicit handler the user
gets a dead player and no message.

Route it to the SAME fallback the boundary renders, so both classes converge on
one outcome. When the surrounding component must stay hook-free, a render
callback keeps the state in the boundary class:

```tsx
export class VideoRenderBoundary extends Component<
  { children: (fail: () => void) => ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  fail = () => this.setState({ failed: true })
  render() {
    if (this.state.failed) return <p>This video can’t be played here.</p>
    return this.props.children(this.fail)
  }
}

// caller
;<VideoRenderBoundary>
  {(fail) => <MuxVideo onError={fail} /* … */ />}
</VideoRenderBoundary>
```

### 4. Contain the RESULT, and accept the session-scoped class honestly

Since the chunk class cannot be contained per-item, contain what the user sees:

- the per-message fallback line, so no turn renders a silent dead box;
- a surviving escape route outside the boundary — for a video card, the caption
  link to the watch page still works when the player does not;
- documentation that says recovery is a **page reload**, because it is.

Do not restate a containment claim without the carve-out. If the surface needs
a user-facing reload affordance, that is a deliberate scope decision to record,
not something the boundary provides.

### 5. Corollary — a CSS-only bound needs a class-mix pin

Related trap on the same surface: when the only bound on untrusted display text
is CSS (`line-clamp-*`), jsdom performs no layout, so no behavioral test can
observe it. The guard is a class-mix denylist assertion — the clamp class is
present AND no display utility sits beside it, since any of them silently
restores `display` and unclamps. Pair it with one dated manual browser check.

## Why This Matters

The failure mode is a doc that is confidently wrong in the exact situation it
exists for. An operator reading "degrades that ONE turn" during an incident
concludes the blast radius is one message and looks elsewhere, while every video
turn in every affected session is degraded until reload.

The retry wrapper is the more expensive half: it looks like diligence, passes
review, adds a code path and a delay, and buys nothing. Only reading the emitted
runtime distinguishes it from the webpack case where the same code works.

## When to Apply

- Adding any lazily-loaded heavy dependency to a per-item render, especially
  media.
- Writing or reviewing a claim that an error boundary limits a failure's scope —
  enumerate the failure classes first, then check each against the boundary.
- Any time a retry around `import()` is proposed.
- Migrating bundlers, or upgrading Next: the eviction behavior is bundler-scoped
  and must be re-verified at the emitted-runtime layer.

## Examples

Verification that settles it, rather than intuition:

```bash
# Does the CACHE FUNCTION return a stored promise once loading has begun?
# (naming loadChunkCached keeps the hit self-evidencing)
grep -o "loadChunkCached[^;]\{0,200\}" .next/static/chunks/turbopack-*.js

# Is any chunk record ever evicted? (0 => a rejection is permanent)
# Records live in a Map, so BOTH forms must be searched: a bare `delete`
# operator AND `Map.prototype.delete`. Grepping only "delete " reports 0 on a
# runtime that calls X.delete(chunkPath) — a false all-clear.
grep -oE '\bdelete[ (]|\.delete\(' .next/static/chunks/turbopack-*.js | wc -l
```

Verified 2026-08-04 on `next@16.2.4` with Turbopack by reading the built runtime
chunk: `loadChunkCached` returns the stored promise whenever `loadingStarted` is
set, records are minted `loadingStarted: false` into a `Map` and nothing resets
the flag, the `onerror` path rejects the stored record without removing it, and
the emitted runtime contains zero eviction calls of either form.

The three failure classes, and what actually contains each:

| Class                             | Contained by the per-message boundary? | Remedy                           |
| --------------------------------- | -------------------------------------- | -------------------------------- |
| Render throw in the media subtree | Yes — one turn                         | `getDerivedStateFromError`       |
| Async playback `error` event      | Not by default                         | `onError` → the same fallback    |
| Chunk load rejected               | **No — whole session**                 | None at the import layer; reload |

## Related

- `docs/solutions/best-practices/react-markdown-untrusted-nesting-crash-freeze-guard.md`
  — the feat-268 per-message-boundary law this entry carves an exception out of.
  That law holds for the render-throw class; this entry bounds its scope.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
  — the same lazily-mounted surface from the measurement side: which window the
  evidence has to cover.
