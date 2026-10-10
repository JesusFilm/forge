---
title: "refactor: /demo-search canonical UX — input validation, button sync, bus hygiene"
type: refactor
status: active
date: 2026-04-22
---

# /demo-search canonical UX — input validation, button sync, bus hygiene

## Overview

Bring the `/demo-search` stakeholder demo to a clean, canonical behavior that satisfies a consolidated 17-rule spec. The current branch (`fix/demo-search-suspense-bus-hardening`, PR #824) has the feature working end-to-end but carries layered fixes from an iterative session that produced multiple button-state sync bugs (spinner flashes on cold load, "Loading…" vs "Composing…" desyncs, stale `searchPending` flags after same-key re-submits, empty-input spinners). This plan collapses the accumulated fixes into a single coherent state model, removes speculative flags, and locks in the rules as invariants an implementer or future agent can verify against.

**This is a hardening pass, not a greenfield rewrite.** Most files already exist. The plan's job is to define the target invariants, identify what must change to satisfy them, and set the verification bar so the sync bugs cannot reappear.

## Problem Frame

`/demo-search` has two visible "Generate" buttons: a hero shortcut (`GenerateShortcutButton`) above the Suspense boundary, and the in-panel button inside `AiExperienceGeneratorDemo` below it. Both should read identical state at every stage: cold load, mid-typing, mid-search, mid-compose, and post-success. The Suspense skeleton is a third visible button during fallback that must also stay aligned.

The existing iteration history produced these defects that must not recur:

1. Hero button flashed a spinner on every cold load because `generatorMounted` started `false` at module scope and was only flipped `true` inside `useEffect`.
2. Pressing Enter with the default query showed hero="Loading…" while in-panel="Composing…" because the Suspense key didn't change, the sentinel didn't remount, and `searchPending` never cleared.
3. Clearing the input showed the hero button disabled with a spinner because the SVG conditional rendered the spinner on any `disabled` state, including empty-input.
4. Mid-type debounced navigation fired a server RPC on every keystroke, flashing the hero into "Loading…" before the user submitted anything.
5. Stale in-flight `run().finally` calls cleared the pending flag that a newer submit had queued, dropping the auto-generate trigger.
6. Zero-result queries stranded the hero button at "Loading…" because the sentinel was inside the conditional that rendered only when `results.length > 0`.

Each of these was a symptom of the same root cause: button state was derived from incidental render-timing facts (`generatorMounted`, `isPending`-that-isn't-really-pending, paint-order flags) instead of a small canonical state machine.

## Requirements Trace

The target behavior — treat as invariants the implementer must not break:

- **R1.** `/demo-search?q=<text>` runs with that text; `/demo-search?q=` (explicit empty) renders a "Waiting for a prompt" validation card with no search fired; `/demo-search` (no `q` param) falls back to the default query `"evidence of the resurrection"`.
- **R2.** `q === undefined` and `q === ""` must be distinguishable at the page boundary — no `||` collapse.
- **R3.** The CMS `semanticSearch` operation is called with `type: "video"` on demo-search paths only. Production `/search` and `SearchOverlay` continue to return mixed content types.
- **R4.** Any content-type filter applied at initial SSR fetch is also applied on client-side pagination ("Load more").
- **R5.** Typing into the demo-search input fires zero server RPCs, zero URL changes, zero spinner flashes. Only `Enter` on a non-empty input navigates.
- **R6.** Hero button states match the state table in "High-Level Technical Design" below, exactly.
- **R7.** In-panel button states match the same state table, with two label overrides: idle label is `"Generate experience with AI"`; success label is `"Try another prompt!"`.
- **R8.** At every moment (cold load first paint, Suspense fallback, post-hydration idle, mid-search, mid-compose, post-success), the hero and in-panel buttons must be in the same logical state. The skeleton button during Suspense fallback is a third visible button and must also be in the same state.
- **R9.** `disabled` and `showSpinner` are computed from different conditions. An empty-input disabled button shows the bolt icon with `cursor: not-allowed`, not a spinner.
- **R10.** Pressing Enter on an empty input is a no-op — no navigation, no `onSubmit`, no bus writes.
- **R11.** The "considered videos" grid only appears after a successful generation, below the generated experience panel, with headings "Videos considered when building this experience" / "Favours felt needs". Never visible during idle, search, or compose.
- **R12.** The Suspense skeleton mirrors the resting shell of the real panel (shared `AiDemoHeader` + `ComparisonStrip`) — not duplicated markup — and its button reads the same computed state as the real buttons.
- **R13.** Zero-result queries don't strand UI state. A lifecycle sentinel inside the Suspense boundary clears `searchPending` on every render path, regardless of results count. Empty-state renders a "No videos matched" card.
- **R14.** `demo-generate-bus.ts` has `"use client"` at the top. The bus exposes only `searchPending`, `generatePending` (token-protected), and the `requestGenerate` trigger. No speculative flags like `generatorMounted`.
- **R15.** `setGeneratePending(true)` returns an opaque `Symbol` token; only `clearGeneratePendingWithToken(token)` can clear it. Stale runs cannot clobber newer queued flags.
- **R16.** No module-level boolean that starts `false` and flips `true` inside `useEffect` is allowed as a loading signal. First-paint state must be deterministic from what the server rendered plus client-set flags.
- **R17.** Manual verification covers the full matrix in "Verification" below on any change touching this page.

## Scope Boundaries

**In scope:**

- Page: `apps/web/src/app/demo-search/page.tsx`
- Client components: `DemoSearchInput.tsx`, `GenerateShortcutButton.tsx`, `AiExperienceGeneratorDemo.tsx`, `GeneratorLifecycleSentinel.tsx`, `AiDemoHeader`/`ComparisonStrip` exports, `DemoSearchResults.tsx`.
- Library: `demo-generate-bus.ts`, `search.ts`, `SearchInput.tsx`, `SearchResults.tsx`.
- Compound docs: `docs/solutions/best-practices/suspense-gated-bus-lifecycle-and-ownership-tokens-20260422.md` (already captures the pattern; update only if behavior diverges).

**Out of scope:**

- Changes to the generator's LLM prompt, schema, or retry behavior.
- Changes to production `/search` or `SearchOverlay` except where the new `manualSubmitOnly` / `preserveEmptyOnSubmit` / `type` props land (they must remain opt-in so those surfaces stay unaffected).
- Changes to `GeneratedSections.tsx` rendering beyond key stability.
- Analytics, A/B testing, or telemetry.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/app/demo-search/page.tsx` — RSC page, currently does query resolution + renders Suspense with `DemoResultsLoader`.
- `apps/web/src/components/demo-search/AiExperienceGeneratorDemo.tsx` — client component owning the generate `run()` and success rendering. Exports `AiDemoHeader` + `ComparisonStrip` for the skeleton to reuse.
- `apps/web/src/components/demo-search/GenerateShortcutButton.tsx` — hero button, subscribes to bus.
- `apps/web/src/components/demo-search/DemoSearchInput.tsx` — wraps shared `SearchInput` with demo-specific bus wiring.
- `apps/web/src/components/demo-search/GeneratorLifecycleSentinel.tsx` — clears `searchPending` on mount inside the Suspense boundary.
- `apps/web/src/lib/demo-generate-bus.ts` — module-level pub/sub with ownership-token pending flag.
- `apps/web/src/lib/search.ts` — `searchVideos()` helper with optional `type` parameter.
- `apps/web/src/components/search/SearchInput.tsx` — shared input with `preserveEmptyOnSubmit`, `manualSubmitOnly` opt-in props.
- `apps/web/src/components/search/SearchResults.tsx` — shared results grid that threads `type` through to client-side pagination.

### Institutional Learnings

- `docs/solutions/best-practices/suspense-gated-bus-lifecycle-and-ownership-tokens-20260422.md` — captures four rules from this session: sentinel lifecycle, ownership tokens, helper parameterization, empty-query validation (4a/4b/4c/4d). This plan carries them forward as invariants.
- `docs/solutions/best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md` — the `?ag=1` URL-param trigger that survives Suspense re-keys. Do not re-introduce queueMicrotask or similar fragile queue schemes.
- `docs/solutions/ui-bugs/react-duplicate-sibling-keys-append-on-rerender-20260421.md` — sibling Fragment key hygiene on the same page. Relevant when touching the page's JSX structure.
- `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md` — the broader pattern the page is built on.

### External References

Not needed. The codebase has strong local patterns and the full iteration history is in this session's compound doc.

## Key Technical Decisions

**D1. Single canonical button state.** Both the hero, the in-panel, and the Suspense-skeleton buttons derive their disabled/spinner/label/cursor state from exactly four inputs: `bus.searchPending`, `bus.generatePending`, `emptyQuery`, `successState` (success-only for the in-panel label override). No other inputs allowed. This is the antidote to every sync bug that appeared during the session.

**D2. `searchPending` is the only navigation signal.** Raised synchronously by `DemoSearchInput.onBeforeNavigate` before the router transition, cleared by `GeneratorLifecycleSentinel.useEffect` on mount. No `generatorMounted` flag, no `useLayoutEffect` tricks, no getServerSnapshot asymmetry.

**D3. Ownership tokens on `generatePending`.** `setGeneratePending(true)` returns a fresh `Symbol`. Clearing requires presenting the token. A fire-and-forget writer (`DemoSearchInput.onSubmit` queuing an autogen) doesn't capture; a full `run()` captures and clears on `finally`. Stale runs that fire after a newer submit cannot clobber the newer queued flag. (See origin: `docs/solutions/best-practices/suspense-gated-bus-lifecycle-and-ownership-tokens-20260422.md` §2.)

**D4. Submit-only navigation on `/demo-search`.** `SearchInput` gains a `manualSubmitOnly` opt-in that disables debounced-on-change navigation. Production `/search` keeps its default on-change debounce. Typing on `/demo-search` makes zero server calls.

**D5. Parameterize `searchVideos` with an optional `type`.** The filter lives at the call site, not baked into the helper. `/demo-search` passes `type: "video"`; `/search` + `SearchOverlay` omit it. `SearchResults` threads the same `type` through to client-side "Load more" so pagination is consistent.

**D6. Skeleton button reads the bus.** The Suspense fallback's button is not a static "Loading…" spinner. It's a client component that subscribes to `searchPending` + `generatePending` and renders whatever the state model says. On cold load (nothing pending), it reads "Generate experience with AI" disabled; during warm nav (searchPending=true), it reads "Loading…" + spinner. This keeps it in sync with the hero during both phases.

**D7. Empty-query validation is a page-level branch, not a component mode.** When `q === ""`, `page.tsx` renders a distinct `<EmptyQueryPrompt>` + sentinel branch. The Suspense + generator are not mounted at all. This keeps the cost of the empty state predictable (no RSC fetch, no embedding charge) and makes the page structure match the user's mental model.

**D8. Considered videos pass as a prop to the generator.** The `consideredVideos` slot is a JSX tree constructed in the RSC `DemoResultsLoader` and passed as a prop into the client `AiExperienceGeneratorDemo`. The generator renders it only when `state.status === "success"`. Its root has a stable `key` to make RSC → client-component reconciliation deterministic.

## Open Questions

### Resolved During Planning

- **Q: How should the hero, in-panel, and skeleton buttons stay in sync on cold load?** Resolved: all three derive from the same bus state via `useSyncExternalStore`. On cold load, bus is idle → all three render idle. On warm nav, `searchPending` fires before the URL transition → all three render loading. D1 + D2 above.
- **Q: How should the skeleton button look during Suspense?** Resolved (D6): it reads the bus, so its appearance is state-driven, not hardcoded.
- **Q: Do we need `generatorMounted`?** No (D2). It was a speculative flag that introduced a paint-window race. `searchPending` alone is the right signal.
- **Q: Should `searchVideos` hardcode the `type` filter?** No (D5). Parameterize and let each caller opt in.

### Deferred to Implementation

- **How to name the unified button-state hook.** Could be `useGenerateButtonState()` returning `{ disabled, showSpinner, label, cursor }`. Implementer picks the name.
- **Where to put the button-state tests.** Suggested: `apps/web/src/components/demo-search/generate-button-state.test.ts` as a pure-function test of the derive logic. Implementer may colocate differently.
- **Whether to memoize the `consideredVideos` JSX value.** React doesn't require memo for single-render RSC outputs. Implementer chooses if profiling shows a need.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

### The canonical button state machine

Given four inputs — `searchPending: boolean`, `generatePending: boolean`, `emptyQuery: boolean`, and (for the in-panel button only) `successState: boolean` — every visible Generate button on the page derives its render from a single table:

```
                     empty   search   gen   success   →   disabled  spinner  label (hero)         label (in-panel)           cursor
row 1 — empty           T       -      -       -           true      false    "Generate"           "Generate experience…"     not-allowed
row 2 — searching       F       T      -       -           true      true     "Loading…"           "Loading…"                 wait
row 3 — composing       F       F      T       -           true      true     "Composing…"         "Composing…"               wait
row 4 — success         F       F      F       T           false     false    "Generate"           "Try another prompt!"      pointer
row 5 — idle            F       F      F       F           false     false    "Generate"           "Generate experience…"     pointer
```

The rows are precedence-ordered: first matching row wins. Every button on the page (hero, in-panel, skeleton) computes its state from this exact table. The only between-button difference is the label column.

The skeleton's button is functionally identical to the hero's but ignores clicks (no `onClick`, or `onClick` is a no-op).

### State transitions (one canonical flow)

```
cold load                         : row 5 (idle)
user types (manualSubmitOnly)     : row 5 (idle) — no nav fires
user clears input                 : row 1 (empty)
user presses Enter on empty       : row 1 (empty) — no-op, stays here
user presses Enter on non-empty   : onBeforeNavigate sets searchPending → row 2 (searching)
                                    RSC fetch resolves, sentinel mounts,
                                    clears searchPending; autogen effect
                                    (from ?ag=1) fires run() which sets
                                    generatePending → row 3 (composing)
run() resolves success             : clears generatePending → row 4 (success, in-panel only) / row 5 (hero)
user clicks "Try another prompt!"  : scrolls to hero, focuses input; no state change
```

### The bus surface

```
demo-generate-bus exports:
  searchPending     : boolean signal, subscribe/set pair
  generatePending   : ownership-token-protected boolean signal
  setGeneratePending(next: boolean): symbol | null
  clearGeneratePendingWithToken(token)
  requestGenerate() + subscribeToGenerateRequests(listener)
```

No other exports. No `generatorMounted`, no `composingState`, no `lastSubmittedQuery`.

### Page structure

```
<main>
  <header>page copy</header>
  <DemoSearchInput defaultValue={inputDefaultValue} />

  {isEmptyQuery ? (
    <>
      <GeneratorLifecycleSentinel key="sentinel-empty" />
      <EmptyQueryPrompt />
    </>
  ) : (
    <Suspense key={query} fallback={<AiExperienceGeneratorSkeleton />}>
      <DemoResultsLoader query={query} />
    </Suspense>
  )}

  <CostLatencyPanel />
</main>
```

Inside `DemoResultsLoader`:

```
<>
  <GeneratorLifecycleSentinel key={`sentinel-${query}`} />
  <SearchModeBanner ... />
  {results.length > 0 ? (
    <AiExperienceGeneratorDemo
      key={`ai-${query}`}
      consideredVideos={<div key="considered-videos">...grid...</div>}
    />
  ) : (
    <NoResultsCard />
  )}
</>
```

## Implementation Units

- [ ] **Unit 1: Lock down the bus surface**

**Goal:** `demo-generate-bus.ts` exposes exactly the minimal signal set. No dead exports, no speculative flags.

**Requirements:** R14, R15, R16.

**Dependencies:** None.

**Files:**

- Modify: `apps/web/src/lib/demo-generate-bus.ts`
- Test: `apps/web/src/lib/demo-generate-bus.test.ts` (new)

**Approach:**

- Verify `"use client"` pragma is first line.
- Module exports: `requestGenerate`, `subscribeToGenerateRequests`, `setGeneratePending` (returns token), `clearGeneratePendingWithToken`, `getGeneratePending`, `subscribeToGeneratePending`, `setSearchPending`, `getSearchPending`, `subscribeToSearchPending`. Anything else — delete.
- Confirm `setGeneratePending(true)` always returns a fresh `Symbol`; `clearGeneratePendingWithToken` is a no-op when the presented token doesn't match the stored one.
- Confirm `setGeneratePending(false)` is supported for legacy callers but discouraged in the docstring.

**Patterns to follow:**

- Match existing module-level listener-Set pattern.

**Test scenarios:**

- Token round-trip: set returns token T1, clear with T1 succeeds, subsequent clear with T1 is no-op.
- Stale-writer protection: set → T1, set → T2 (replaces T1), clear with T1 is no-op, clear with T2 succeeds.
- Listener fires on change only: setting the same value twice fires once.
- Unsubscribe removes the listener from the Set.
- SSR guard: calling any setter during an `if (typeof window === 'undefined')` block throws or is a no-op — decide one and test it. Recommended: no-op with a dev-only warning.

**Verification:**

- `grep -r generatorMounted apps/web/src` returns nothing.
- New test file passes.
- Existing bus consumers compile unchanged.

- [ ] **Unit 2: Canonical button state as a shared pure function**

**Goal:** One pure function derives `{ disabled, showSpinner, label, cursor }` from `{ searchPending, generatePending, emptyQuery, successState?, variant: "hero" | "in-panel" | "skeleton" }`. Every visible Generate button on the page uses this function. No alternative local state machines.

**Requirements:** R6, R7, R8, R9.

**Dependencies:** Unit 1.

**Files:**

- Create: `apps/web/src/components/demo-search/generate-button-state.ts`
- Create: `apps/web/src/components/demo-search/generate-button-state.test.ts`
- Modify: `GenerateShortcutButton.tsx`, `AiExperienceGeneratorDemo.tsx`, `page.tsx` (skeleton inline)

**Approach:**

- Exported `deriveGenerateButtonState()` takes the four inputs + variant. Returns the render-ready state. Precedence matches the table in Technical Design.
- `GenerateShortcutButton` reads bus via `useSyncExternalStore`, passes to the function with `variant: "hero"`.
- `AiExperienceGeneratorDemo`'s button reads bus + local `state.status === "success"` for `successState`, passes with `variant: "in-panel"`.
- `AiExperienceGeneratorSkeleton`'s button reads bus (new — currently static) with `variant: "skeleton"`. Renders `onClick={undefined}` and `disabled` always-true (the function's disabled output may be false in the idle row; the skeleton renders it as disabled regardless since it has no handler).

**Execution note:** Implement the pure function test-first. The table in Technical Design is the test matrix.

**Patterns to follow:**

- `useSyncExternalStore` usage in current `GenerateShortcutButton`.

**Test scenarios:**

- All five rows of the state table, for all three variants: 15 cases.
- Hero variant with `successState: true` falls through to idle label (hero doesn't show "Try another prompt!"). Verify explicitly.
- Skeleton variant's `disabled` output is always `true` regardless of row (defensive — skeletons have no handler).

**Verification:**

- All 15 tests pass.
- Grepping for inline `?: "Loading…" : "Composing…"` ternaries in `GenerateShortcutButton` / `AiExperienceGeneratorDemo` / skeleton returns zero hits.
- Manually: cold-load `/demo-search` shows both visible buttons reading "Generate" (enabled) / "Generate experience with AI" (enabled) with no spinner anywhere.

- [ ] **Unit 3: `SearchInput` opt-ins — `manualSubmitOnly` and `preserveEmptyOnSubmit`**

**Goal:** Shared `SearchInput` gets two opt-ins that `/demo-search` uses. Production `/search` behavior is unchanged.

**Requirements:** R1, R2, R5, R10.

**Dependencies:** None.

**Files:**

- Modify: `apps/web/src/components/search/SearchInput.tsx`
- Modify: `apps/web/src/components/demo-search/DemoSearchInput.tsx`
- Test: `apps/web/src/components/search/SearchInput.test.tsx`

**Approach:**

- `manualSubmitOnly?: boolean` (default false). When true, `handleChange` updates local value but skips `debouncedNavigate`.
- `preserveEmptyOnSubmit?: boolean` (default false). When true, Enter on empty input navigates to `?q=` (empty-preserving) rather than stripping `q`. But Enter on empty is a no-op anyway per R10, so this flag only affects the debounced path + direct-URL typing paths.
- `handleKeyDown` Enter branch: if `value.trim() === ""`, return immediately (no navigation, no `onSubmit`, no `onBeforeNavigate`). This is R10.
- DemoSearchInput passes both flags: `manualSubmitOnly`, `preserveEmptyOnSubmit`.

**Test scenarios:**

- With `manualSubmitOnly`: `onChange` called 10 times with different values → router.replace called 0 times.
- With `manualSubmitOnly` + Enter on non-empty: router.replace called exactly once.
- With default (no `manualSubmitOnly`): debounced navigation fires after 300ms.
- Enter on empty (with or without `preserveEmptyOnSubmit`): router.replace called 0 times, onSubmit called 0 times.
- Enter on non-empty: router.replace called with correctly-encoded query + `extraQueryOnSubmit` suffix.

**Verification:**

- Typing on `/demo-search` fires zero network requests (DevTools Network tab).
- Typing on `/search` still fires debounced navigation (unchanged).
- Tests pass.

- [ ] **Unit 4: Page-level query resolution + empty-query branch**

**Goal:** `page.tsx` distinguishes `q === undefined` from `q === ""` and renders three distinct branches: default-query demo, explicit-empty validation card, non-empty query demo. Zero-result handling + sentinel wiring.

**Requirements:** R1, R2, R11, R13.

**Dependencies:** Unit 3.

**Files:**

- Modify: `apps/web/src/app/demo-search/page.tsx`
- Verify: `apps/web/src/components/demo-search/GeneratorLifecycleSentinel.tsx` clears `searchPending` only. No `generatorMounted` calls remain.

**Approach:**

- `const hasExplicitQuery = typeof q === "string"`; `const trimmedQuery = q?.trim() ?? ""`; `const isEmptyQuery = hasExplicitQuery && trimmedQuery === ""`; `const query = hasExplicitQuery ? trimmedQuery : DEFAULT_QUERY`.
- Page JSX branches on `isEmptyQuery`:
  - True → render `<GeneratorLifecycleSentinel key="sentinel-empty" />` + `<EmptyQueryPrompt />`. Do not render Suspense.
  - False → render `<Suspense key={query} fallback={<AiExperienceGeneratorSkeleton />}><DemoResultsLoader query={query} /></Suspense>`.
- Inside `DemoResultsLoader`:
  - Always render `<GeneratorLifecycleSentinel key={`sentinel-${query}`} />` first — even on zero-result paths.
  - If `results.length === 0` → render a "No videos matched" empty-state card, no generator.
  - Else → render `<AiExperienceGeneratorDemo key={`ai-${query}`} consideredVideos={consideredVideos} />`.
- `consideredVideos` root `<div>` has `key="considered-videos"` for RSC → client reconciliation stability.

**Patterns to follow:**

- Existing `DEFAULT_QUERY`, `INITIAL_RESULTS_LIMIT` constants.
- `CONTENT_WIDTH_CLASSES` for layout.

**Test scenarios:**

- Server render with no `q` → page title is `"Semantic search demo"`, full demo renders with default query.
- Server render with `?q=` → page renders "Waiting for a prompt" card, no `searchVideos` call fired (verify by mocking the client and asserting 0 query calls).
- Server render with `?q=asdfqwerty` that returns 0 results → "No videos matched" card rendered, sentinel still present in the tree.

**Verification:**

- Manually: `/demo-search?q=` shows validation card; hero button disabled (empty input). No embedding cost charge (check the CostLatencyPanel session counters stay flat).
- Manually: `/demo-search` (no param) shows full demo with default query.
- Type a fake 20-char query, submit — if zero results, empty-state card renders and hero button recovers to enabled "Generate".

- [ ] **Unit 5: Considered-videos slot gated on success + shared shell components**

**Goal:** `AiExperienceGeneratorDemo` renders `consideredVideos` only when `state.status === "success"`. Shared `AiDemoHeader` + `ComparisonStrip` exports eliminate skeleton/live drift.

**Requirements:** R11, R12.

**Dependencies:** Unit 2.

**Files:**

- Modify: `apps/web/src/components/demo-search/AiExperienceGeneratorDemo.tsx`
- Modify: `apps/web/src/app/demo-search/page.tsx` (skeleton uses shared exports)

**Approach:**

- `AiExperienceGeneratorDemo` accepts `consideredVideos?: ReactNode` (use `import type { ReactNode } from "react"`, not `React.ReactNode`).
- Render `{state.status === "success" && consideredVideos}` at the bottom of the panel.
- Export `AiDemoHeader({ anchorId?: string })` and `ComparisonStrip({ latencyMs: number | null })` from the same file.
- `AiExperienceGeneratorSkeleton` in `page.tsx` composes `<AiDemoHeader />` + `<ComparisonStrip latencyMs={null} />` + a skeleton-variant button (per Unit 2).
- The `consideredVideos` JSX tree lives in `DemoResultsLoader` (per Unit 4) with the outer `<div key="considered-videos">` and contains the h2 "Videos considered when building this experience" + p "Favours felt needs" + `<DemoSearchResults>`.

**Test scenarios:**

- Render `AiExperienceGeneratorDemo` with `state.status: "idle"` → considered-videos NOT in DOM.
- Transition `state.status: "idle" → "composing" → "success"` → considered-videos appears only in success frame.
- Render with `state.status: "error"` → considered-videos NOT in DOM.
- Skeleton and live-panel render byte-identical `<AiDemoHeader>` output (snapshot test).

**Verification:**

- Toggle generation state via dev tools / React DevTools and confirm grid show/hide behavior.
- Grep for duplicated "Live agent demo" or "Feed the search results" strings in the demo-search folder: should appear exactly once (inside `AiDemoHeader`).

- [ ] **Unit 6: `searchVideos` parameterization + `SearchResults` load-more consistency**

**Goal:** Content-type filter lives at the call site. Pagination uses the same filter as the initial SSR.

**Requirements:** R3, R4.

**Dependencies:** None.

**Files:**

- Modify: `apps/web/src/lib/search.ts` (already done — verify `type?: SearchContentType` parameter in `searchVideos`).
- Modify: `apps/web/src/components/search/SearchResults.tsx` (already done — verify `type?` prop threaded to load-more fetch).
- Modify: `apps/web/src/components/demo-search/DemoSearchResults.tsx` (already done — verify passes `type="video"`).
- Modify: `apps/web/src/app/demo-search/page.tsx` (already done — verify passes `"video"` to `searchVideos`).
- Confirm: `apps/web/src/app/search/page.tsx` and `apps/web/src/components/SearchOverlay.tsx` do NOT pass a type.
- Test: `apps/web/src/lib/search.test.ts`

**Approach:**

- Verify the existing code matches Unit 6's target shape. No rewrite needed if verify passes. Add a focused test.

**Test scenarios:**

- `searchVideos("q")` → calls `client.query` with `variables.type === undefined`.
- `searchVideos("q", 20, 0, "video")` → calls `client.query` with `variables.type === "video"`.
- `SearchResults` with `type="video"` prop, user clicks "Load more" → client.query called with same `type: "video"`.
- `SearchOverlay.search` → asserts `type === undefined` in variables (unchanged behavior).

**Verification:**

- Production `/search` SSR + load-more both return mixed content types (visible in a real query that has both video + experience results).
- `/demo-search` SSR returns video-only results.

- [ ] **Unit 7: Verification matrix + documentation refresh**

**Goal:** The verification matrix from R17 passes manually on the current branch, and the compound doc is up to date.

**Requirements:** R17 + all.

**Dependencies:** Units 1-6.

**Files:**

- Verify: `docs/solutions/best-practices/suspense-gated-bus-lifecycle-and-ownership-tokens-20260422.md` still accurately reflects the implementation. Amend if the plan's state-machine rewrite introduces anything new worth compounding.
- No code changes unless verification surfaces a bug.

**Approach:**

- Run through the full verification matrix in the "Verification" section below, in a real browser with DevTools open.
- Record any observations. If an observation contradicts a rule, that's a bug — add a new implementation unit, do not loosen the rule.

**Verification:** See page-level "Verification" section below.

## System-Wide Impact

- **Interaction graph:** Changes ripple only through the demo-search page and shared `SearchInput`/`SearchResults` behind opt-in props. `/search` and `SearchOverlay` are unaffected by default. Verify before merge that neither surface has regressed.
- **Error propagation:** `searchVideos().catch(...)` remains the top-level error sink. `run()` in `AiExperienceGeneratorDemo` catches and sets `state.status: "error"`. No new error paths introduced.
- **State lifecycle risks:** The ownership-token scheme on `generatePending` is the critical lifecycle safety net. Any new writer to `generatePending` must follow the token contract. Document this in the setter's JSDoc.
- **API surface parity:** `searchVideos` gains an optional param. `SearchInput` gains two opt-in props. `SearchResults` gains one optional prop. All backward-compatible at the call-site level; nothing removed.
- **Integration coverage:** Unit tests cover the bus, the button-state function, and `SearchInput` handler behavior. End-to-end (manual in browser) covers the cross-component state sync across Suspense boundaries.

## Risks & Dependencies

- **Risk: state-machine refactor re-introduces the exact sync bugs it's meant to prevent.** Mitigation: the table in Technical Design is the authoritative source; implement the pure function first and test it exhaustively before wiring into any component.
- **Risk: `manualSubmitOnly` changes accidentally leak into `/search`.** Mitigation: default is `false`. Unit-test the default path. Spot-check `/search` in browser before merging.
- **Risk: the skeleton button reading the bus causes a hydration mismatch.** Mitigation: `useSyncExternalStore`'s `getServerSnapshot` returns `false` on the server for both pending flags, so SSR renders the idle state; client first paint matches. On warm nav, the URL transition itself kicks a new SSR streaming pass, so the skeleton re-renders with the new server-state as fallback.
- **Dependency:** None external. This is purely a web-app refactor.
- **Sequencing:** Unit 1 (bus) → Unit 2 (button state fn) → Units 3-6 in parallel → Unit 7 verify.

## Verification

Every rule check below must be passed in a real browser with DevTools (Network + React DevTools) open. Regressions here are bugs.

1. **Cold load `/demo-search`** — First paint: hero button "Generate" (enabled, bolt icon, no spinner). In-panel button (or skeleton during Suspense) "Generate experience with AI" (disabled in skeleton, enabled in real panel, no spinner). No network requests fire for anything except the RSC fetch + images. No React console warnings.

2. **Typing into a non-empty default query** — Each keystroke updates the input value and the character counter. Zero network requests fire. Hero stays on "Generate" (enabled). URL does not change.

3. **Clear input to empty** — After last backspace: hero button disabled, bolt icon (no spinner), cursor `not-allowed`. URL eventually updates to `?q=` (via debounced path, since `preserveEmptyOnSubmit` is set but `manualSubmitOnly` blocks change-nav — this one may not fire; that's acceptable as long as pressing Enter on empty does nothing per #4).

4. **Press Enter with empty input** — No navigation, no `onSubmit`, URL unchanged, hero stays disabled. DevTools Network tab shows zero new entries.

5. **Press Enter with non-empty input (default query)** — Hero transitions to "Loading…" + spinner synchronously with Enter. Skeleton (if visible) also shows "Loading…" + spinner. URL updates to `?q=<query>&ag=1`. After RSC resolves, both buttons transition to "Composing…" together. After success, hero reads "Generate" (enabled) and in-panel reads "Try another prompt!" (enabled). Considered-videos grid is visible below with the correct headings.

6. **Press Enter with a new query different from current** — Same as #5 but Suspense key changes → skeleton visible during RSC → smooth transition through "Loading…" → "Composing…" → success.

7. **Navigate directly to `?q=`** — Validation card "Waiting for a prompt" / "Type a query to run the demo" renders. Hero disabled (empty input). No embedding cost charge (CostLatencyPanel session counter unchanged). No Suspense skeleton shown.

8. **Navigate directly to `?q=xyzzyqwerty` (guaranteed zero results)** — Sentinel fires. Hero recovers to "Generate" (enabled). "No videos matched" card renders. No embedding-cost-of-generation charge.

9. **No React console warnings** — Especially no "Each child in a list should have a unique key" warnings. Run through all the above flows.

10. **Production `/search` unaffected** — Load `/search?q=resurrection`, verify mixed video + experience results. Click "Load more" if visible, verify still mixed.

## Sources & References

- **Prior plans:**
  - `docs/plans/2026-04-20-001-feat-demo-search-showcase-plan.md`
  - `docs/plans/2026-04-21-001-feat-demo-search-ai-experience-generator-plan.md`
- **Institutional learnings:**
  - `docs/solutions/best-practices/suspense-gated-bus-lifecycle-and-ownership-tokens-20260422.md`
  - `docs/solutions/best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md`
  - `docs/solutions/ui-bugs/react-duplicate-sibling-keys-append-on-rerender-20260421.md`
  - `docs/solutions/best-practices/nextjs-server-action-llm-structured-output-pattern-2026-04-21.md`
- **Related PR:** https://github.com/JesusFilm/forge/pull/824 (the current in-progress branch).
- **Session spec:** Canonical rules prompt captured in the conversation that produced this plan.
