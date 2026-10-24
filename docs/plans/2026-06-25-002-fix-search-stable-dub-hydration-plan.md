---
title: "fix: Stabilize search hydrated dub selection"
type: "fix"
date: "2026-06-25"
execution: "code"
---

# fix: Stabilize search hydrated dub selection

## Summary

Stabilize Admin search card hydration so repeated identical searches return the
same fallback `playbackId` when multiple playable dubs share the same duration.
The fix keeps the existing ranking, score, and hydration semantics while making
the SQL row choice deterministic.

## Problem Frame

The result-preservation check for the Admin search latency PR showed stable
result IDs, order, and scores, but `jesus` returned different hydrated
`playbackId` values across repeated identical requests. The optimized hydration
query ordered playable dubs by duration only; equal-duration rows could be
returned in different orders by Postgres.

## Requirements

- R1. Repeated identical search requests return stable hydrated fallback
  `playbackId` values for equal-duration dubs.
- R2. Search result ranking, result IDs, scores, snippets, and existing
  primary-language dub preference remain unchanged.
- R3. The fix stays scoped to search hydration and does not alter retrievers,
  fusion, trace writes, or query embedding caching.
- R4. Regression coverage guards the deterministic ordering contract.

## Key Technical Decisions

- **Add a deterministic tie-breaker:** Keep duration-descending dub selection
  and add a stable `video_dub` ID tie-breaker so equal-duration rows do not
  depend on executor order.
- **Preserve hydration semantics:** Continue selecting primary-language dubs
  first when present, otherwise fall back to the first playable dub from the
  bounded hydration window.
- **Test the SQL contract directly:** Assert the hydration SQL's
  `row_number() OVER (...)` window contains the tie-breaker because the
  nondeterminism comes from rank ordering, not service mapping logic.

## Implementation Units

### U1. Stabilize Hydration Dub Ordering

- **Goal:** Make the playable-dub hydration window deterministic for
  equal-duration rows.
- **Requirements:** R1, R2, R3
- **Dependencies:** none
- **Files:**
  - `apps/admin/src/services/hybrid-search.service.ts`
- **Approach:** Extend the `hydration.videoDub.query` window ordering from
  duration-only to duration plus a stable row identifier. Keep the existing
  per-video row cap and downstream primary-language/fallback selection.
- **Patterns to follow:** Existing hydration query labels and display-only
  fallback behavior in `apps/admin/src/services/hybrid-search.service.ts`.
- **Test scenarios:**
  - Equal-duration playable dubs are ordered with a stable tie-breaker.
  - Primary-language dub preference remains the selected duration source when
    available.
- **Verification:** Repeated prod searches should keep the same result IDs,
  order, scores, and hydrated fallback playback IDs.

### U2. Add Regression Coverage

- **Goal:** Prevent the hydration dub query from drifting back to nondeterminism.
- **Requirements:** R4
- **Dependencies:** U1
- **Files:**
  - `apps/admin/src/services/hybrid-search.service.test.ts`
- **Approach:** Add a focused service test that executes card hydration and
  inspects the generated raw SQL for deterministic duration-plus-ID ordering
  inside the `video_dub` `row_number() OVER (...)` hydration window.
- **Patterns to follow:** Existing card-pill hydration tests in
  `apps/admin/src/services/hybrid-search.service.test.ts`.
- **Test scenarios:**
  - The hydration SQL for `video_dub` orders the `row_number() OVER (...)`
    hydration window by `vd.duration DESC, vd.id ASC`.
  - Existing card-pill hydration tests continue to prove duration, child count,
    playback fallback, and hydration failure behavior.
- **Verification:** Focused Admin search tests, typecheck, lint, and CI remain
  green.

## Scope Boundaries

- In scope: deterministic ordering for hydrated playable dubs used by search
  card display fields.
- Out of scope: search ranking changes, retriever SQL changes, trace-write
  offloading, query embedding cache changes, and broader playback-language
  product decisions.

## Risks & Dependencies

- **Data tie behavior:** The fix assumes `video_dub.id` is stable and unique,
  which matches the Prisma model and Postgres primary-key contract.
- **Prod parity proof:** A full old-code-vs-new-code prod DB comparison is not
  available from the local shell because Railway exposes only private internal
  database hosts to `railway run`.

## Sources & Research

- `docs/roadmap/content-discovery/feat-175-admin-semantic-search-latency.md`
- `docs/plans/2026-06-25-001-perf-admin-search-hydration-semantic-cache-plan.md`
- `docs/solutions/performance-issues/admin-search-result-preserving-latency-optimization.md`
- `apps/admin/src/services/hybrid-search.service.ts`
- `apps/admin/src/services/hybrid-search.service.test.ts`
