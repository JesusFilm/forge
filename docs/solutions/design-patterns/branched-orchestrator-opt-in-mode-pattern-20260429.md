---
title: "Single branched orchestrator beats twin functions for opt-in mode arguments"
category: "design-patterns"
problem_type: "best_practice"
component: "service_object"
root_cause: "missing_validation"
resolution_type: "code_fix"
severity: "medium"
module: "apps/cms"
tags:
  - architecture
  - opt-in-mode
  - api-design
  - orchestrator
  - feature-flag
  - byte-identical-default
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#feat-109"
related_docs:
  - "docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md"
  - "docs/solutions/best-practices/rrf-fusion-heterogeneous-content-types-20260415.md"
---

## Problem

When adding an opt-in alternative to an existing pipeline (e.g. a new
search retrieval mode that must coexist with the legacy one), the obvious
move is to fork the orchestrator into twin functions: `searchHybrid()`
and `searchKeywordFirst()`. This duplicates 100+ lines of shared
embedding/fusion/dedup/pagination logic and creates two drift-prone
copies of the byte-identical-default contract. A single branched
orchestrator with one shared spine is cheaper to reason about and
easier to lock down with a regression test.

## Symptoms

- A new feature ticket asks for "an opt-in alternative pipeline" and the
  natural-feeling design is "duplicate the function, swap the swappable
  bits."
- Resulting code: `searchHybrid()` and `searchKeywordFirst()` share 80%
  of their bodies, plus a top-level dispatcher that's just one
  if-statement. Reviewer asks: "what stops these from drifting?"
- Six months later: a bugfix lands in one branch and not the other.

## What Didn't Work

- Twin orchestrator functions with a shared `dispatch(mode)` entry. The
  shared code is comment-line-by-comment-line identical at the start
  and decays with each edit.
- Strategy-pattern abstraction (one orchestrator, mode-keyed strategy
  object). Justifiable for 5+ modes; for 2 modes it's a premature
  abstraction that pays no rent.
- Feature-flag wrapping the entire pipeline. Conflates "is this user
  opted in?" with "what retrievers should run?" The feature flag belongs
  at the boundary, not inside the orchestrator.

## Solution

**Single orchestrator, branched once at the smallest divergence point.**
Embedding, experience retrievals, fusion, dedup, and pagination stay
shared. Only the work that _actually differs_ between modes lives inside
an `if (mode === "keyword-first") { … } else { … }` block. Per-mode
work that's substantial (e.g. a post-fusion dilution cap) lives in a
helper called from inside the branch:

```ts
export async function search(
  strapi: Core.Strapi,
  params: SearchParams,
): Promise<SearchResponse> {
  const { query, locale } = params
  const limit = clampLimit(params.limit)
  const offset = Math.max(0, params.offset ?? 0)

  // Normalize the mode arg ONCE; all downstream branches read from a
  // closed RetrievalMode union.
  const mode: RetrievalMode = normalizeMode(strapi, params.mode)

  // Embedding is shared.
  const queryEmbedding = await safeEmbed(query)

  // Build the retrieval set. Branch ONLY on the mode-specific delta.
  const retrievals: Retrieval[] = []
  if (wantsVideos) {
    retrievals.push(buildSemanticVideoRetrieval(...))  // shared
    if (mode === "keyword-first") {
      retrievals.push(buildKeywordWeightedRetrieval(...))
      retrievals.push(buildTrigramRetrieval(...))
      retrievals.push(buildExactTitleRetrieval(...))
    } else {
      retrievals.push(buildLegacyKeywordRetrieval(...))  // unchanged
    }
  }
  if (wantsExperiences) {
    // shared in both modes
  }

  // Fusion, dedup, paginate — all shared.
  const fused = fuseRankedLists(...)
  if (mode === "keyword-first") applyDilutionCap(fused, ...)
  return paginate(deduplicateResults(fused, ...), offset, limit)
}
```

Two design rules make the pattern hold up:

1. **`mode` is a nullable String at the API boundary, not a closed
   enum.** Future modes (`"instant"`, `"persona-aware"`) ship as new
   values without a schema change. Unknown values warn-and-fall-back to
   the default (never error) — see `normalizeMode`.

2. **The default is byte-identical to the pre-feature baseline.** A
   regression snapshot test (see related doc) gates every change to the
   orchestrator: any commit that breaks default behavior fails CI before
   reviewers see it.

## Why This Works

- **Shared spine = single source of truth.** Bug fixes and feature
  additions to the embedding/fusion/pagination steps don't need
  per-mode echoes.
- **Branch at the smallest divergence point.** The two retrieval sets
  differ; everything else is shared. Branching at _exactly_ that point
  minimizes the surface where drift can happen.
- **Helpers contain per-mode complexity.** `applyDilutionCap` is
  keyword-first-only by gate, but lives outside the orchestrator. The
  orchestrator stays a high-level read of the pipeline.
- **Nullable-String input keeps the API extensible.** Adding a third
  mode in the future means: (a) extend the `RetrievalMode` union, (b)
  add a third branch to `normalizeMode`, (c) add the per-mode work.
  No GraphQL schema change.

## Prevention (recurring trap to avoid)

**`mode` (input) vs `searchMode` (response) naming collision.** If the
response already has a degradation/health field named `searchMode`,
adding an input `mode` argument with overlapping literals (both have
`"hybrid"`) is a foot-gun. The TS type system can't disambiguate; the
literal `"hybrid"` means different things in input and output. Document
the orthogonality in the GraphQL schema description and the input type's
JSDoc, AND consider renaming one side (`pipelineHealth` for the response,
`retrievalStrategy` for the input) before the API ships to consumers.

```ts
// Bad: same string, two meanings
type SearchParams = { mode?: "hybrid" | "keyword-first" }
type SearchResponse = { searchMode: "hybrid" | "keyword-only" }

// Better: distinct vocabularies
type SearchParams = { retrievalStrategy?: "default" | "keyword-first" }
type SearchResponse = { pipelineHealth: "ok" | "degraded-keyword-only" }
```

## Prevention (testing)

- **Test-first regression snapshot.** Lock in byte-identical-default
  before any new-mode code lands. See related doc.
- **Assert the new retrievers are NEVER called on the default path.**
  Behavioral check, not just response-shape check — a future refactor
  could dispatch the new retrievers unconditionally (returning [] in
  tests) and the JSON-equality test would still pass.

## Related

- `apps/cms/src/api/search/services/search.ts` — feat-109's branched
  orchestrator.
- `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md` —
  the test pattern that gates this approach.
