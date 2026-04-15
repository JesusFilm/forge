---
title: "Composing N-way RRF safely with heterogeneous content types"
category: "best-practices"
problem_type: "best_practice"
component: "service_object"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "medium"
module: "apps/cms"
tags:
  - rrf
  - reciprocal-rank-fusion
  - search
  - hybrid-search
  - ranking
  - typescript
  - strapi
  - cms
date: "2026-04-15"
related_prs:
  - "JesusFilm/forge#777"
related_docs:
  - "docs/solutions/best-practices/hybrid-semantic-search-api-strapi-v5-pgvector.md"
  - "docs/solutions/performance-issues/pgvector-hnsw-index-bypass-with-where-filter-20260415.md"
---

# Composing N-way RRF safely with heterogeneous content types

When extending a Reciprocal Rank Fusion search from one content type to many (e.g. videos + experiences + future personalization signals), two non-obvious traps surface that don't matter in the single-type case. Both produce **silent ranking bugs** rather than errors — tests that only assert "results are returned" will pass while the relevance contract quietly breaks.

## Problem

RRF is famously simple: `score = sum(1 / (k + rank_i))` for each list a result appears in, normalized by `lists.length / (k + 1)`. The contract is "give me N ranked lists, get back one fused list." This works perfectly when every list ranks items from the same identity space (one type of content) and every list is non-empty.

When you fuse heterogeneous content types (video + experience + ...) the implementation has to handle two quiet failure modes that the math glosses over.

## Failure mode 1: integer ID collision across content types

Most fusion implementations use the result's identity (`videoId`, `productId`, etc.) as the Map key. With one content type this is fine — IDs are unique within the type. With multiple types, **ID 4 in the video table and ID 4 in the experience table collide on the same Map key**.

Symptom: the higher-scoring result silently overwrites the lower-scoring one, or property merging produces a Frankenstein object with fields from both types. No error, just the wrong result set.

## Failure mode 2: empty input lists dilute the normalization

RRF normalizes scores by `theoreticalMax = lists.length / (k + 1)`. Pass 4 lists where 2 are empty (because semantic embedding failed, or because no keyword match exists for the locale): `lists.length` is still 4, so a result that's rank-1 in both _contributing_ lists scores `(2/(k+1)) / (4/(k+1)) = 0.5` instead of the intended `1.0`.

Symptom: scores compress toward zero. If any downstream consumer thresholds on score (e.g., "only show results > 0.7"), the threshold is never met. Ranking order is preserved but absolute values lie.

## Solution

### 1. Compound identity key for the fusion Map

Don't key the fusion accumulator by the bare result ID. Key it by `${resultType}:${resultId}`:

```typescript
// fusion.ts
export type RankedItem = {
  resultType: "video" | "experience"
  resultId: number
  // ...other fields, kept in an open index signature for now
  [key: string]: unknown
}

export function fuseRankedLists(
  lists: RankedItem[][],
  k: number = 60,
): FusedResult[] {
  const scoreMap = new Map<string, number>() // <-- string, not number
  const propsMap = new Map<string, RankedItem>()

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]
      const key = `${item.resultType}:${item.resultId}` // <-- compound
      const contribution = 1 / (k + rank + 1)
      scoreMap.set(key, (scoreMap.get(key) ?? 0) + contribution)
      // ...property merge
    }
  }
  // ...normalize and sort
}
```

This costs nothing — Map<string> performs identically to Map<number> for this access pattern — and eliminates the entire collision class.

The same compound-key discipline extends to dedup. If your dedup logic is type-specific (e.g., "two videos with prefix-matching `core_id` are duplicates"), guard it with a type check so it doesn't accidentally merge across types:

```typescript
function deduplicateResults(results: FusedResult[]): FusedResult[] {
  // ...
  for (const candidate of results) {
    if (candidate.resultType === "video") {
      // video-specific dedup checks (core_id prefix, title match, embedding similarity)
    }
    // experiences pass through unchanged — their dedup story is different
  }
}
```

The orchestrator owns the wiring — search functions stay agnostic of the multi-type model:

```typescript
// search.ts orchestrator
function annotateVideo<T extends { videoId: number }>(item: T): T & RankedItem {
  return { ...item, resultType: "video", resultId: item.videoId }
}

const videoResults = await searchBySemantic(...)  // returns SemanticResult, no resultType
const tagged = videoResults.map(annotateVideo)    // adds compound identity
fuseRankedLists([tagged, ...otherLists], 60)
```

This keeps the existing video search functions backward-compatible. They never had to know about the fusion contract.

### 2. Filter empty lists before passing them to RRF

```typescript
// orchestrator
const lists = outcomes.map((o) => unwrapOutcome(o)) // may produce []
const nonEmpty = lists.filter((list) => list.length > 0)
const fused = fuseRankedLists(nonEmpty, RRF_K) // accurate normalization
```

Two situations make this load-bearing:

- **Conditional retrievals**: a `?type=video` API filter fires only video retrievals; the unfired experience retrievals shouldn't appear as empty placeholders in the fusion call.
- **Graceful degradation**: when one retrieval fails (semantic embedding service down, pgvector timeout) and `Promise.allSettled` returns it as `[]`, the score normalization should reflect what actually contributed.

The combined effect: a result ranked #1 in the only contributing list scores `1.0` (correct), not `1/N` where N counts empty lists.

## Why this works

**Compound key**: RRF's identity contract is "two items in different lists with the same key are the same item." That contract only holds within a single identity namespace. Adding a type prefix creates a wider namespace where each `(resultType, resultId)` pair is a unique anchor. Cross-type collisions become impossible by construction.

**Empty filtering**: RRF's normalization assumes every input list is a real opinion about ranking. An empty list isn't an opinion — it's the absence of one. Including it in the divisor punishes lists that did contribute, in a way that compounds with `lists.length`. Filtering is the simplest way to make `theoreticalMax` reflect actual signal.

## Prevention

### Tests that catch these bugs

Both failures are silent. Add tests that assert on values, not just shapes:

```typescript
// Compound key collision test
it("does not collide a video and an experience with the same integer ID", () => {
  const results = fuseRankedLists(
    [
      [{ resultType: "video", resultId: 4 }],
      [{ resultType: "experience", resultId: 4 }],
    ],
    60,
  )
  expect(results).toHaveLength(2) // both survive
})

// Empty-list filtering test
it("does not pass empty lists into fusion", async () => {
  // Mock 1 retrieval to return data, 3 to return empty
  await search(strapi, { query: "test", locale: "en" })
  const passedLists = vi.mocked(fuseRankedLists).mock.calls[0][0]
  expect(passedLists).toHaveLength(1) // not 4
})

// Score normalization test (verifies the math, not just the order)
it("rank-1 in the only contributing list scores 1.0, not 0.25", () => {
  // Without empty-list filtering this test fails with score ≈ 0.25
})
```

The score-value test is the canary. If a refactor accidentally re-introduces empty-list passing, the order tests still pass but the value test fails.

### Where to look in code review

- Any `Map<number, ...>` or `Record<number, ...>` in a fusion / dedup / merge layer where multiple result types are in play.
- Any `Promise.allSettled([...])` followed directly by a fusion call without a length filter.
- Any switch/branch on `result.type` (or equivalent discriminator) that doesn't have a default branch — ID-collision bugs often manifest as missing default handling.

### Generalizes beyond RRF

The same two patterns apply to any N-way ranking aggregator that accumulates per-item scores across lists:

- Borda count
- Comb-SUM / Comb-MNZ
- Weighted blending
- Custom "boost on appearance in any list" logic

If you're combining scores from heterogeneous sources, key by `(type, id)` and ignore empty inputs.
