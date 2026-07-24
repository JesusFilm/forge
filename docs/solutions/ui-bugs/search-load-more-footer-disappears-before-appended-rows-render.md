---
title: Search "Load more" footer vanishes before the appended page becomes visible
date: 2026-07-24
category: ui-bugs
module: apps/mobile
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - Tapping the search "Load more" footer button made it vanish immediately with no new results visible for ~2-3s
  - The fetch itself completed quickly — the perceived slowness was not a data-fetch delay
  - Appended rows (indices 20-39) mounted at opacity 0 and occupied layout space, pushing the loading footer below the fold
  - Rows silently faded in 1.2-2.6s + 280ms later, well after the footer had already disappeared
  - Only reproduces on page >=2 of search results; the first page's entrance animation looks correct
root_cause: async_timing
resolution_type: code_fix
severity: medium
related_components:
  - apps/mobile/app/(tabs)/watch.tsx
  - apps/mobile/src/components/search/SearchResultCard.tsx
  - apps/mobile/src/components/search/searchEntrance.ts
  - apps/mobile/src/components/search/searchEntrance.test.ts
tags:
  - mobile
  - search
  - pagination
  - flatlist
  - entrance-animation
  - load-more
  - react-native
---

# Search "Load more" footer vanishes before the appended page becomes visible

## Problem

On the mobile Watch search results grid, tapping the "Load more" footer button made the button vanish immediately while no new results appeared for ~2-3 seconds, then the next page popped in all at once. The button looked like it had finished and dismissed itself, but the screen stayed empty in the meantime — reading, to a user, as a stall or a swallowed tap. This was NOT a data-fetch problem: the page had already been fetched and its rows were mounted; they were simply animating in from `opacity: 0` on a delay that scaled with their absolute position in the list.

Fixed in PR #1706 (open / unmerged as of writing).

## Symptoms

- Tap "Load more" → the footer button disappears within a frame.
- A blank gap sits where the button was for roughly 2-3 seconds; nothing new is visible.
- The second page then appears in a staggered cascade, seemingly "late".
- The delay grows with how deep you page: page 3's gap is worse than page 2's.
- Frame-by-frame capture on the iOS simulator shows a run of frames where the appended rows occupy layout height (they have pushed the footer down and off-screen) but render at zero opacity.

## What Didn't Work — the trap

The instinct is to treat this as a slow or flaky data fetch: add a spinner, extend a timeout, retry the query, blame the network or the admin `watchSearch` resolver. That framing is a dead end, and here is why it is provably wrong:

- The fetch completes fast. `loadMore` awaits one `getApolloClient().query(...)` (apps/mobile/app/(tabs)/watch.tsx:442) and immediately calls `setResults((prev) => [...prev, ...page.results])` (watch.tsx:465-468). By the time the gap is visible, the rows are already in state.
- The rows ARE mounted. FlatList renders each appended `SearchResultCard`, and each card's `onLayout` fires — they occupy real layout space, which is exactly why they shove the `ListFooterComponent` (the "Load more" button) below the fold.
- They are just invisible. `SearchResultCard` mounts at `opacity: new Animated.Value(0)` and `scale: 0.92` (SearchResultCard.tsx:31-32) and only fades in after a per-card entrance delay.

So the "missing" results were never missing. Any fix aimed at the fetch (spinners, timeouts, retries) leaves the real defect — an entrance animation delay keyed to the wrong number — completely untouched.

## Solution

Two coordinated changes, both addressing the same symptom from opposite ends: make the entrance stagger batch-relative, and hold the footer's loading state until the appended rows are actually on screen.

### Part 1 — batch-relative, capped entrance stagger

New pure module `apps/mobile/src/components/search/searchEntrance.ts` owns the timing so the card and the footer can never disagree:

```ts
export const ENTRANCE_STAGGER_MS = 60
export const ENTRANCE_DURATION_MS = 280
export const ENTRANCE_MAX_STAGGER_STEPS = 8

export function entranceDelayMs(
  index: number,
  batchStartIndex: number,
): number {
  const step = Math.min(
    Math.max(0, Math.trunc(index) - Math.trunc(batchStartIndex)),
    ENTRANCE_MAX_STAGGER_STEPS,
  )
  return step * ENTRANCE_STAGGER_MS
}

export const REVEAL_FALLBACK_MS =
  ENTRANCE_MAX_STAGGER_STEPS * ENTRANCE_STAGGER_MS + ENTRANCE_DURATION_MS + 500
```

(searchEntrance.ts:4-32, grounded.)

Before, the card computed its own delay from the absolute FlatList index — effectively `delay = index * 60ms`. After, `watch.tsx` passes `entranceDelay={entranceDelayMs(index, batchStartRef.current)}` (watch.tsx:524), so the stagger restarts from the first index of each newly arrived batch and is capped at 8 steps (480ms) so a full 20-item page still finishes appearing within a tap's attention span.

Each card pins its delay at mount so a later append can't restart an entrance the user already watched (SearchResultCard.tsx:35):

```ts
// Pinned at mount: appending a later page shifts this card's position, and a
// re-derived delay would restart an entrance the user has already watched.
const delayRef = useRef(entranceDelay)
```

The entrance effect reads `delayRef.current`, not the live prop (SearchResultCard.tsx:44-63).

### Part 2 — hold the footer until the batch's first row lays out

`watch.tsx` records where the new batch begins, inside the `setResults` updater on append (watch.tsx:465-468):

```ts
setResults((prev) => {
  batchStartRef.current = prev.length
  return [...prev, ...page.results]
})
awaitingRevealRef.current = true
if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
revealTimerRef.current = setTimeout(releaseLoadingMore, REVEAL_FALLBACK_MS)
```

A fresh search resets it to 0 (watch.tsx:341). `renderItem` wires the batch's leading card — and only that card — to report back (watch.tsx:529-531):

```ts
onAppear={index === batchStartRef.current ? handleBatchRevealed : undefined}
```

`SearchResultCard` fires `onAppear` exactly once per mount, from `onLayout`, guarded by `appearedRef` (SearchResultCard.tsx:36-42). `handleBatchRevealed` releases the latch (watch.tsx:516-518), and `REVEAL_FALLBACK_MS` (~1.26s) is a backstop timer for a list that never reports at all.

The crucial change is in `loadMore`'s `finally`. Before, it unconditionally cleared the loading latch when the request finished — which is what let the button flip to done before the rows were visible. After, it is guarded (watch.tsx:503-511):

```ts
} finally {
  // Only the owning generation, and not a page awaiting a reveal, releases
  // here; search() resets both flags unconditionally, and a page awaiting
  // reveal releases on layout instead — see onAppear.
  if (requestIdRef.current === thisRequest && !awaitingRevealRef.current) {
    loadingMoreRef.current = false
    setLoadingMore(false)
  }
}
```

To keep this from wedging the footer on "Loading..." forever, `search()` calls `releaseLoadingMore()` unconditionally at its start (watch.tsx:269), so a superseding search always frees the latch even though it bumps the generation and orphans the in-flight page's guarded `finally`. `releaseLoadingMore` clears the fallback timer first, then disarms both flags (watch.tsx:186-194), so a pending fallback can never land on a page that claimed the slot after it.

## Why This Works

Two distinct root causes, one visible symptom:

1. **Stagger keyed to ABSOLUTE list index instead of batch-relative.** With `PAGE_SIZE = 20` (watch.tsx:52), page 2 lands at indices 20-39. An absolute-index stagger (`index * 60ms`) gives those cards delays of 1200ms-2340ms, plus the 280ms fade — so the last card of page 2 finished appearing ~2.6s after it was appended, and page 3 (indices 40-59) was worse. The cards held their layout space the entire time, so the footer was already pushed off-screen while the grid looked empty. Restarting the stagger from `batchStartIndex` collapses every batch's first card to delay 0, and the `ENTRANCE_MAX_STAGGER_STEPS` cap keeps even a full page's tail under half a second of stagger.

2. **Releasing the loading latch on fetch-completion instead of on-screen layout.** The footer's "Loading..." → "Load more" flip was tied to the async request settling, which happens well before the appended rows finish animating in. Retiming the release to the batch's first `onLayout` (with a fallback ceiling) means the footer can never announce "done" onto a blank gap — the loading state now spans the true gap between the tap and the results being visible, not just the network round-trip. `REVEAL_FALLBACK_MS` is deliberately set above a full batch's worst-case entrance (`8*60 + 280 + 500 = 1260ms`) so it only fires when the layout signal genuinely never arrives, never as a race that pre-empts the real signal (searchEntrance.test.ts:41-50 asserts this ordering).

## Prevention

- **Never key an entrance/stagger animation to an item's absolute position in an append-only list.** The delay must be relative to the batch the item arrived in, or every appended page inherits an ever-growing invisible-hold. Add a cap so a large batch's tail still lands within a human attention span.
- **Pin animation timing at mount for list items that can shift position.** A re-derived delay on re-render restarts an entrance the user already watched. `delayRef = useRef(entranceDelay)` is the pattern (SearchResultCard.tsx:35).
- **Tie "loading finished" UI to when the result is VISIBLE, not when the promise resolves,** whenever the two are separated by a non-trivial entrance animation. A latch released on fetch-completion will flip to done over an empty screen.
- **When verifying UI-timing fixes, use frame-by-frame simulator capture, not a single after-screenshot.** The bug and the fix both live in the sub-3-second window between tap and reveal; a static screenshot taken a beat too early or too late proves nothing. Verify every mobile fix in the iOS simulator — restart Metro, reload the sim, capture before reporting done (auto memory [claude]). And confirm the simulator is running THIS worktree's Metro on a free port: `expo start` on an occupied port silently prints "Skipping dev server" and leaves the app on another worktree's stale bundle, so a timing fix can read as "not fixed" or, worse, as a false "fixed" (auto memory [claude]).
- **Extract the reveal-latch race into a pure reducer and unit-test it.** This is the honest known gap: only the pure timing helper (`searchEntrance.ts`) has tests (`searchEntrance.test.ts` covers the batch-relative restart, the cap, the non-negative floor, and the `REVEAL_FALLBACK_MS` ordering). The STATEFUL latch logic in `watch.tsx` — `awaitingRevealRef` / `revealTimerRef` / `releaseLoadingMore` / the guarded `finally` and its interaction with a superseding `search()` — has NO test. The repo convention for exactly this race-class is to lift it into a pure reducer and unit-test the transitions (see the design-patterns solution `mobile-auto-hide-overlay-fade-race-ref-sync` and `controlsVisibility.ts`); that extraction was not done here and is the recommended follow-up. Test at minimum: (a) release-on-layout beats the fallback timer; (b) the fallback fires when no layout is reported; (c) a superseding search frees a latch left armed by an orphaned page; (d) two rapid presses don't double-append.
- **Note one subtlety worth a targeted test.** A code review raised a "stale `onLayout` releases a newer batch's latch" hazard — a superseded row's `onAppear` firing late and releasing the wrong batch. It was validated FALSE across three independent checks: FlatList's `strictMode` defaults false, so it uses a non-memoized renderer that rebuilds the `renderItem` closure every render (and `numColumns={2}` (watch.tsx:618) likewise hands each cell a fresh data array), so `onAppear` is re-derived and a superseded row is set to `undefined` before any layout fires; and `batchStartRef` always names a fresh, never-yet-mounted index. It holds today but rests on FlatList internals — a regression test that appends a batch, then forces a re-render, and asserts only the current batch's leading index carries an `onAppear` handler would pin the invariant.

## Related Issues

- `docs/solutions/best-practices/mobile-search-ui-patterns-20260416.md` — documents this exact screen (`watch.tsx` / `SearchResultCard.tsx`) from the original search build. Its "guard the finally block" rule states `loadMore`'s `finally` must **unconditionally** clear `loadingMore`; this fix made that `finally` conditional (`&& !awaitingRevealRef.current`) while preserving the never-stuck guarantee via `search()`'s unconditional `releaseLoadingMore()` plus the fallback timer. That doc's rule is now stale for the current code and is a `ce-compound-refresh` candidate.
- `docs/solutions/design-patterns/mobile-auto-hide-overlay-fade-race-ref-sync.md` — same structural hazard class (a boolean ref used as ground truth that an async completion callback can race), and the repo's pure-reducer remedy that the reveal latch here should adopt for testability.
- PR #1706 — the change described here (open / unmerged as of writing).
