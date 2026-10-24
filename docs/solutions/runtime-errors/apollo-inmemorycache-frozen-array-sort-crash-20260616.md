---
title: 'Apollo InMemoryCache freezes results — in-place Array.sort throws "Cannot assign to read-only property"'
date: "2026-06-16"
category: runtime-errors
module: apps/mobile
problem_type: runtime_error
component: frontend_stimulus
symptoms:
  - 'Render Error on the video detail page: "TypeError: Cannot assign to read only property ''0'' of object ''[object Array]''"'
  - "Crashes only for videos whose Bible citations come back needing a reorder; videos without citations render fine"
  - "Invisible to tsc and eslint — the mutation only throws at runtime when the data is read from a warm (frozen) cache"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - apps/mobile/src/lib/normalizeVideo.ts
tags:
  - apollo
  - inmemorycache
  - immutability
  - array-sort
  - react-native
  - normalizer
---

# Apollo InMemoryCache freezes results — in-place Array.sort throws "Cannot assign to read-only property"

## Problem

`normalizeVideo` sorted the raw `bibleCitations` array in place. Apollo Client's `InMemoryCache` freezes the objects it returns, so `Array.prototype.sort()` — which reorders elements in place — threw a render-time `TypeError` that crashed the entire video detail page.

## Symptoms

- `TypeError: Cannot assign to read only property '0' of object '[object Array]'`, surfaced as a full-screen React "Render Error" when opening a video.
- Reproduces deterministically for any video whose cached `bibleCitations` need reordering; videos without citations are unaffected.
- No `tsc` or `eslint` warning — it only throws at runtime once the data is read from a warm (frozen) cache.

## What Didn't Work

- **Trusting the sibling sorts as proof the pattern was safe.** The adjacent `studyQuestions` and `episodes` sorts in the same file never crashed — but only because each runs _after_ `.filter()`, which returns a fresh (unfrozen) array. `bibleCitations` sorted the raw array directly, so it was the only unsafe call. The working siblings masked the hazard.
- **Mocked/unit fixtures with plain arrays.** The existing `normalizeVideo` tests passed an ordinary mutable `bibleCitations` array, exercising the sort without ever touching the frozen-array path. Reverting the fix left every test green — the crash was structurally unproven until a frozen fixture was added (see Prevention).

## Solution

Copy the array before sorting so `sort()` mutates a throwaway copy, never the frozen cache object:

```ts
// apps/mobile/src/lib/normalizeVideo.ts

// Before — sorts the frozen Apollo array in place (throws):
const bibleCitations = (raw.bibleCitations ?? [])
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map(/* ... */)

// After — spread into a fresh, mutable array first:
const bibleCitations = [...(raw.bibleCitations ?? [])]
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map(/* ... */)
```

`arr.toSorted(...)` (ES2023) is an equivalent non-mutating alternative where the runtime supports it.

## Why This Works

Apollo's `InMemoryCache` returns deep-frozen result objects (immutable results), so a read from a warm cache hands back a frozen array. `Array.prototype.sort()` reorders by assigning to indices in place, and assigning to a frozen array's index throws `TypeError: Cannot assign to read only property` in strict mode (all ES modules are strict). Spreading into `[...]` (or `Array.from` / `.slice()` / `.toSorted()`) produces a new, unfrozen array that `sort()` is free to mutate. The chained `.map()` already returns a new array, so only the in-place `sort()` was the problem. A method that mutates `this` is never safe to call directly on data the cache owns — the fix is the copy, not the sort.

## Prevention

- **Copy before any in-place array method (`sort`, `reverse`, `splice`) on data read straight off an Apollo result.** If a `.filter()`/`.map()` already precedes it, the array is a fresh copy and is safe; a bare `.sort()` on `raw.<field>` is the smell.
- **Add a frozen-array regression test** so the fix is load-bearing — a plain-array test passes whether or not the copy exists:

```ts
it("sorts a frozen bibleCitations array without mutating it", () => {
  const frozen = Object.freeze([
    { documentId: "bc-2", order: 2 /* ... */ },
    { documentId: "bc-1", order: 1 /* ... */ },
  ])
  const result = normalizeVideo(makeRawVideo({ bibleCitations: frozen }))!
  expect(result.bibleCitations[0].documentId).toBe("bc-1")
})
```

Order is inverted so `sort()` must swap (touch the frozen array); revert the spread and this test fails with the exact production error.

## Related Issues

- `docs/solutions/best-practices/mobile-video-detail-page-patterns-20260527.md` — canonical `normalizeVideo.ts` patterns (the safe sibling sorts live here).
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the frozen-fixture test is an instance of this discipline (a test where only the real contract, not the mocked shape, can pass).
- `docs/solutions/architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md` — establishes the normalizer layer that `normalizeVideo` belongs to.
- (session history) The TV-side normalizer already sorted **copies** of variant/subtitle arrays (to preserve the source index for selection write-back), so the non-mutating pattern existed elsewhere in the codebase — it just hadn't been applied to mobile's `bibleCitations`.
- Shipped in PR #1275.
