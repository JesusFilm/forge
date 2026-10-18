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
blocks:
  - "feat-736"
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

Keep meaningful fresh compact relation/value notes and exact resolvable transcript spans or metadata evidence. Carry all useful discoveries, including valid partial-parent discoveries after output-driven complete-assignment splitting, into each source's global rank. Final 5–8 full explanations/value/evidence, fewer justified. Deduplicate evidence losslessly in an explicit per-call lookup, preserving every relation/value and evidence association, correct video/chunk/field identity and the complete source. Source evidence aliases that complete source. Final evidence still expands from frozen originals. If the full-evidence handoff overflows, globally select final IDs from ALL notes/pointers and target identity/title metadata, then verify/write only that final set with original resolved evidence. Stop if either measured fallback request overflows; never prune the pool.

Serialize an overlapping source/target video once, keeping its exact target membership through an explicit source-entry alias. Trusted lookup semantics preserve both independent directions between distinct sources; self remains excluded from recommendations. Measure the actual deduplicated envelope and dynamic schema, without truncation or increased context limits.

Each physical reservation/receipt immutable. Known incomplete output can refine capacity with new child call IDs; unknown/failed physical work cannot be blindly retried. Proven pre-reservation no-dispatch allowance pauses must resume with fresh admission, preserving attempts and successful checkpoints. Summarize actual once-per-call known usage and unknowns separately. Independent review/merge precedes coordinator-owned generation; old artifacts remain untouched.

## Verification

Focused fake-transport tests: capacity grouping/full coverage, compact reference roundtrip/invalid refs, complete per-source handoff/final evidence, parent partial preservation/output splits, bounded concurrency/settlement, catalog checkpoint resume, allowance-before-reservation resume, failed/unknown/pending replay refusal and truthful usage totals. Typecheck, touched lint/format and exact offline measurements before live admission. No actual savings/quality claim until measured generation and review.

Verified read reuse is an explicit offline admission of a settled parent's **entire complete reading coverage**, not a retry mechanism. Bind parent manifest/artifact hashes and original physical origins in a fresh child plan/manifest; validate identical corpus/references/discovery requests/schema/context, all successful known receipts, exact evidence and complete split-tree coverage before any child dispatch. Discovery stays unchanged; fresh phase digests/policy bind finalization changes; no receipt copying/relabeling or parent mutation. Parent rejected/unknown ranking usage remains linked and separate from new physical calls; aggregate unique origins once. No partial imports or reuse chains.

Additional checks: lossless lookup roundtrip (including metadata/source aliases), actual six-read pool measurement, oversized expanded-pool fixture, complete/partial-parent tree reuse, stopped-before-ranking admission, ranking-only child dispatch/replay, immutable parent bytes, tampered/missing/unknown read refusal and truthful lineage accounting. Generation evidence and final review remain pending; retain in-progress status.

Measured overflow fallback: one global all-note final selector (no target quote text or shared memory; notes remain untrusted interpretations), then one selected-evidence verifier/finalizer. Every discovered option is considered jointly for the final5–8/fewer justified; no per-batch pools or preliminary shortlist. Finalizer accounts for every choice as recommended or explicitly rejected, cannot invent replacements, and saves exact original evidence. New phases have distinct deterministic physical origins and actual usage; selection/evidence loss is documented. This is not a lossless fallback or a quality/savings claim. Verify route choice, all-note coverage, selected exact evidence/rejection, invalid IDs/duplicates, genuine stage overflow, safe immutable read reuse and replay/unknown pauses. Keep in-progress pending actual generation/review.
