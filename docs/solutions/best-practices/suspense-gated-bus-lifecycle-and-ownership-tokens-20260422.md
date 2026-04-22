---
title: "Sentinel lifecycle + ownership tokens for client pub/sub buses coordinating across a Next.js Suspense boundary"
date: "2026-04-22"
last_updated: "2026-04-22"
category: best-practices
module: apps/web
problem_type: best_practice
component: web
severity: medium
root_cause: framework_misuse
resolution_type: code_fix
related_components:
  - apps/web/src/app/demo-search/page.tsx
  - apps/web/src/components/demo-search/AiExperienceGeneratorDemo.tsx
  - apps/web/src/components/demo-search/DemoSearchInput.tsx
  - apps/web/src/components/demo-search/GenerateShortcutButton.tsx
  - apps/web/src/components/demo-search/GeneratorLifecycleSentinel.tsx
  - apps/web/src/components/search/SearchInput.tsx
  - apps/web/src/lib/demo-generate-bus.ts
  - apps/web/src/lib/search.ts
related_docs:
  - "docs/solutions/best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md"
  - "docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md"
tags:
  - react
  - nextjs
  - app-router
  - suspense
  - usesync-external-store
  - pubsub-bus
  - client-state
  - demo-search
  - react-strict-mode
  - graphql-filter
  - input-validation
  - empty-query
---

# Sentinel lifecycle + ownership tokens for Suspense-gated client buses

## Problem

`/demo-search` has two visible "Generate" buttons: a hero shortcut (`GenerateShortcutButton`) that lives **above** the Suspense boundary, and the full `AiExperienceGeneratorDemo` that lives **inside** it. Both read a module-level pub/sub bus (`demo-generate-bus.ts`) to stay synchronized on `pending` / `searching` / `generatorMounted` state. The bus pattern works for the happy path but exposes three defects in edge cases:

1. **Zero-result queries strand the hero button at "Loading…".** The bus lifecycle signals (`setSearchPending(false)`, `setGeneratorMounted(true)`) were set inside `AiExperienceGeneratorDemo`'s mount effect. When the search returned zero results, the parent gated the render on `data.results.length > 0`, so the generator never mounted, the setters never fired, and the hero button stayed disabled forever with no recovery path.
2. **Stale in-flight generate clobbers a newer queued flag.** `run().finally` called `setGeneratePending(false)` unconditionally, and a second unmount effect did the same. If the user submitted a new query while a prior `run()` was still in flight, `DemoSearchInput.onSubmit` would raise `pending=true` as the queued trigger for the next mount — only for the stale run's `.finally` to clear it right after. The newly-queued auto-generate silently disappeared.
3. **`searchVideos` hardcoded `type: "video"`**, but the helper is shared with the production `/search` page and `SearchOverlay`, silently narrowing those callers' result sets. Fixing only demo-search required either a local filter or parameterizing the helper.

## Symptoms

- Hero shortcut button stuck on "Loading…" with spinner after typing a query that returns zero results; no subsequent click re-enabled it.
- Rare: Enter-key submit of a new query during in-flight generation would search successfully but never auto-generate — user had to click Generate again.
- Silent behavior regression: `/search` page would have lost experience results after the videos-only filter landed.

## What Didn't Work

- **Keeping lifecycle setters inside `AiExperienceGeneratorDemo`.** Looked cleanest (one component owns its side effects) but broke on any render path that didn't mount it. The correct locus is "every path the Suspense boundary resolves through," not "every path that has results."
- **Relying on `run().finally` + unmount-cleanup to clear pending.** Both cleared the flag without checking who set it, so any later-arriving write from a stale owner could overwrite a queued value.
- **Adding `type: "video"` directly in `searchVideos`.** Pushed the filter one layer too low, leaking it into every caller.

## Solution

### 1. Split lifecycle signals into an always-mounted sentinel

```tsx
// apps/web/src/components/demo-search/GeneratorLifecycleSentinel.tsx
"use client"

import { useEffect } from "react"
import { setGeneratorMounted, setSearchPending } from "@/lib/demo-generate-bus"

export function GeneratorLifecycleSentinel() {
  useEffect(() => {
    setSearchPending(false)
    setGeneratorMounted(true)
    return () => setGeneratorMounted(false)
  }, [])
  return null
}
```

```tsx
// apps/web/src/app/demo-search/page.tsx
return (
  <>
    <GeneratorLifecycleSentinel key={`sentinel-${query}`} />
    <SearchModeBanner mode={data.searchMode} />
    {data.results.length > 0 ? (
      <AiExperienceGeneratorDemo key={`ai-${query}`} ... />
    ) : (
      <EmptyState query={query} />
    )}
  </>
)
```

The sentinel renders `null` — its only job is to keep bus lifecycle signals truthful regardless of which branch the parent chose. The feature component (`AiExperienceGeneratorDemo`) is now free to mount or not based on business logic without breaking siblings that depend on "has Suspense resolved?"

### 2. Ownership tokens for multi-writer bus flags

```ts
// apps/web/src/lib/demo-generate-bus.ts
let pending = false
let pendingToken: symbol | null = null

export function setGeneratePending(next: boolean): symbol | null {
  if (next) {
    const token = Symbol("generate-pending")
    pending = true
    pendingToken = token
    pendingListeners.forEach((l) => l())
    return token
  }
  if (pending) {
    pending = false
    pendingToken = null
    pendingListeners.forEach((l) => l())
  }
  return null
}

export function clearGeneratePendingWithToken(token: symbol | null): void {
  if (token == null || pendingToken !== token) return
  pending = false
  pendingToken = null
  pendingListeners.forEach((l) => l())
}
```

```tsx
// apps/web/src/components/demo-search/AiExperienceGeneratorDemo.tsx
async function run() {
  if (isPending) return
  const pendingToken = setGeneratePending(true)
  setIsPending(true)
  try {
    // ... fetch ...
  } finally {
    setIsPending(false)
    clearGeneratePendingWithToken(pendingToken)
  }
}
```

Each `run()` captures the token it set; only that run can clear it. If a newer submit has already raised a fresh token before the stale run's `finally` fires, the clear is a no-op and the queued flag survives.

Writers that want "fire and forget" (`DemoSearchInput.onSubmit`) keep using `setGeneratePending(true)` without capturing a token — they don't need to clear, only to queue.

### 3. Parameterize shared helpers; don't hardcode at the lowest layer

```ts
// apps/web/src/lib/search.ts
export type SearchContentType = "video" | "experience"

export async function searchVideos(
  query: string,
  limit = 20,
  offset = 0,
  type?: SearchContentType,
) {
  // ...
  variables: { query: truncatedQuery, locale: "en", limit, offset, type }
  // ...
}
```

```ts
// Demo-search opts in; /search + SearchOverlay keep default (no filter)
await searchVideos(query, INITIAL_RESULTS_LIMIT, 0, "video")
```

Threaded through `SearchResults`'s `type?: SearchContentType` prop so client-side "Load more" sends the same filter as initial SSR. Consistency: one operation → one set of variables across all pages.

### 4. Empty-query validation: distinguish "no param" from "explicit empty", disable submit paths, keep spinner off disabled-from-empty

Three separate rules compose here. All of them matter.

**Rule 4a — distinguish `q === undefined` (cold load) from `q === ""` (user intent).** Collapsing them into `q?.trim() || DEFAULT_QUERY` makes "user cleared the input and hit Enter" indistinguishable from "user navigated to the page." The former should render a validation state; the latter should fall back to the default.

```ts
// apps/web/src/app/demo-search/page.tsx
const { q } = await searchParams
const hasExplicitQuery = typeof q === "string"
const trimmedQuery = q?.trim() ?? ""
const isEmptyQuery = hasExplicitQuery && trimmedQuery === ""
const query = hasExplicitQuery ? trimmedQuery : DEFAULT_QUERY
```

To surface this distinction from the client, the input must _preserve_ the empty query in the URL rather than stripping it. Gate this behind an opt-in prop so the production `/search` page keeps its existing behavior:

```tsx
// apps/web/src/components/search/SearchInput.tsx — opt-in flag
preserveEmptyOnSubmit?: boolean

// debounced typing path
if (query.trim()) {
  router.replace(`${searchPath}?q=${encodeURIComponent(query.trim())}`)
} else if (preserveEmptyOnSubmit) {
  router.replace(`${searchPath}?q=`)
}
```

**Rule 4b — stub submit paths when the input is empty.** Don't just render the validation state after navigation; block the navigation at the source. Enter on empty should be a no-op, and the Generate button should be `disabled`.

```tsx
// SearchInput — Enter on empty is a no-op
function handleKeyDown(e) {
  if (e.key === "Enter" && onSubmit) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return // no navigation, no onSubmit
    // ... proceed
  }
}

// GenerateShortcutButton — factor emptyQuery into disabled
const disabled = pending || loading || emptyQuery
function handleClick() {
  if (emptyQuery) return
  // ... proceed
}
```

```tsx
// DemoSearchInput wires it up from the same length state that drives
// the character counter.
<GenerateShortcutButton emptyQuery={length === 0} />
```

**Rule 4c — spinner tracks _actual_ loading, not `disabled`.** The naïve implementation shows a spinner whenever `disabled === true`. That breaks the empty-query case: the button is legitimately disabled but nothing is loading, so the spinner becomes a phantom "stuck forever" indicator. Split the two conditions:

```tsx
const disabled = pending || loading || emptyQuery
const showSpinner = loading || pending
const cursorClass =
  emptyQuery && !showSpinner
    ? "disabled:cursor-not-allowed"
    : "disabled:cursor-wait"

// render
{
  showSpinner ? <Spinner /> : <DefaultIcon />
}
```

The cursor swap matters for affordance: `wait` says "come back in a moment"; `not-allowed` says "you can't do this until you change something."

**Prevention summary.**

- Treat `undefined` and `""` as distinct URL inputs whenever an app has a non-trivial default. Name the distinction (`hasExplicitQuery`) — don't leave it to `||` collapsing.
- Never ship an input that can submit an empty value if the downstream won't accept it. Block at the source (Enter handler + button `disabled`), not just the result renderer.
- If you show a spinner whenever `disabled`, you'll inherit bugs the day any non-loading reason can disable the button. Separate "is loading" from "is unclickable" at the render layer from day one.

### 5. `"use client"` on any module with module-level mutable state

```ts
// apps/web/src/lib/demo-generate-bus.ts
"use client"

let pending = false
let searchPending = false
let generatorMounted = false
```

Guards against a future RSC import silently leaking state across concurrent requests on a warm Node process. Build-time error beats a production-load failure mode.

## Why This Works

- **Sentinels separate "framework lifecycle" signals from "feature state."** The Suspense boundary resolving is a framework event every consumer above it cares about; it shouldn't be locked inside a conditionally-rendered feature component. A zero-line `return null` component owning exactly those side effects makes the invariant explicit: if the sentinel mounts, the boundary has resolved — full stop.
- **Ownership tokens fix the two-writers-one-flag race.** Booleans on a shared bus with N unsynchronized writers is inherently a data race; tokens turn each write into a mini-CAS (compare-and-swap) so late writers can't overwrite newer state they never saw.
- **Parameterizing at the helper boundary keeps cross-page contracts explicit.** Every caller of `searchVideos` now declares its intent at the call site. Future readers can `grep '"video"'` and find every page that opts into the filter — no inheritance by mistake.
- **`"use client"` is a build-time assertion** for modules that assume client-only execution semantics. Cheaper than a runtime guard, catches future refactors that otherwise silently bite in production.

## Prevention

**When to reach for a sentinel.** Any time sibling components above a Suspense boundary depend on lifecycle state that was owned by a conditionally-rendered component inside the boundary, split the lifecycle signal into a `*Sentinel.tsx` that renders `null`. Mount it in the parent unconditionally on whatever render path matters.

**Rule for bus pending flags.** If two or more call sites write to the same bus flag, writers that flip `true→false` must either (a) own a token from their own `true` write, or (b) be demonstrated to be the only writer. A comment on the setter documenting which writers are allowed saves the next maintainer from this debug session.

```ts
// Good — documented ownership
// setGeneratePending(true) — returns a token; only that token can clear.
// setGeneratePending(false) — no-op for multi-writer safety.
// Use clearGeneratePendingWithToken(token) instead.
```

**Shared helper contract test.** Add a test that asserts `searchVideos(q)` (no type arg) passes `type: undefined` to the GraphQL client, so a future hardcode regression fails CI:

```ts
it("omits type when caller does not specify", async () => {
  const spy = vi.spyOn(client, "query").mockResolvedValue(emptyResponse)
  await searchVideos("test")
  expect(spy.mock.calls[0][0].variables).toMatchObject({ type: undefined })
})
```

**`"use client"` as default for any `/lib/*-bus.ts` module.** If the module has `let`/`const { listeners }` at the top level, it's stateful and must be client-only. Make it a grep rule in CI or a codeowners note.

**Known pattern cross-refs:**

- Queuing across Suspense re-keys with URL params: `docs/solutions/best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md`
- The pattern `/demo-search` is built on: `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`
