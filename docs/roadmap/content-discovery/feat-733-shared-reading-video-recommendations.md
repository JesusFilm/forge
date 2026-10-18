---
id: "feat-733"
title: "Share complete-library recommendation readings across sources"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-19"
duration: 3
depends_on:
  - "feat-710"
blocks: []
tags: [recommendations, ai-pipeline, subscription]
---

## Problem

The accepted one-source full-library pilot repeatedly reads the library for each source. Measure shared-reading-v1 with up to four complete sources per exhaustive target pass and compact exact evidence references, preserving the accepted v1 baseline. Offline projections do not establish savings, quality or subscription-week fit.

## Entry Points

- `apps/mastra/src/services/precomputed-recommendations/shared-reading-v1.ts`: complete-reference catalog, capacity-only source groups, exhaustive target batches, compact discovery, per-source global ranking and durable run/resume/accounting.
- `apps/mastra/src/scripts/run-shared-reading-recommendations.ts`: offline plan/admitted full-catalog execution.
- `docs/plans/2026-10-19-shared-reading-recommendations.md`: bounded design and verification.
- `docs/solutions/workflow-issues/shared-reading-recommendation-generation.md`: operator interface and limitations.

## Constraints

Astra via existing guarded ChatGPT included-subscription transport only; minimum remaining 25% by default. No paid APIs/credits/reset, retrieval/profile stage, top-K gate, shared model memory, silent truncation, public activation or direct deployment. Normal reviewed PR-to-main flow. Complete transcript/metadata targets for every admitted source; self/true duplicate exclusions only. Preserve distinct useful chapters/parents/siblings. Up to four sources split by measured capacity; at most two reading calls in flight.

Keep meaningful fresh compact relation/value notes and exact resolvable transcript spans or metadata evidence. Carry all useful discoveries, including valid partial-parent discoveries after output-driven complete-assignment splitting, into each source's global rank. Final 5–8 full explanations/value/evidence, fewer justified. If global handoff does not fit, stop without pruning.

Serialize an overlapping source/target video once, keeping its exact target membership through an explicit source-entry alias. Trusted lookup semantics preserve both independent directions between distinct sources; self remains excluded from recommendations. Measure the actual deduplicated envelope and dynamic schema, without truncation or increased context limits.

Each physical reservation/receipt immutable. Known incomplete output can refine capacity with new child call IDs; unknown/failed physical work cannot be blindly retried. Proven pre-reservation no-dispatch allowance pauses must resume with fresh admission, preserving attempts and successful checkpoints. Summarize actual once-per-call known usage and unknowns separately. Independent review/merge precedes coordinator-owned generation; old artifacts remain untouched.

## Verification

Focused fake-transport tests: capacity grouping/full coverage, compact reference roundtrip/invalid refs, complete per-source handoff/final evidence, parent partial preservation/output splits, bounded concurrency/settlement, catalog checkpoint resume, allowance-before-reservation resume, failed/unknown/pending replay refusal and truthful usage totals. Typecheck, touched lint/format and exact offline measurements before live admission. No actual savings/quality claim until measured generation and review.
