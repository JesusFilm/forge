---
id: "feat-709"
title: "Full-library directional video recommendations"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-16"
duration: 3
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "recommendations"
---

## Problem

Measure a separate full-library-v1 generator that discovers useful directional connections from complete eligible transcript and metadata input. Preserve feat-590 results, profiles, usage and checkpoints.

## Entry Points — Read These First

1. `apps/mastra/src/services/precomputed-recommendations/full-library-v1.ts`: exhaustive batch planning, evidence validation and checkpointed generation.
2. `apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra.ts`: included-subscription-only Astra transport.
3. `apps/mastra/src/scripts/run-full-library-recommendations.ts`: offline planning and local pilot execution.
4. `docs/plans/2026-10-16-full-library-recommendations.md`: pilot boundaries and verification.

## Grep These

`full-library-v1`, `consumptionUnknown`, `generateReserved`, `validateSelectedChunks`.

## What To Build

Measure complete input against the locally verified effective model context. Prefer shared context when it fits; otherwise repeat complete source transcripts across exhaustive target batches. Carry every discovered connection and exact evidence into global ranking. Save ranked target IDs, directional explanation and added watching value; aim for 5–8 strong recommendations per source with justified shortfalls. Validate exact evidence, IDs, self and actual duplicate identities (equal nonempty core ID/slug, including alternate Dubs of the same Video). Distinct chapters, siblings and parent films remain eligible when they add viewing value; family membership alone is not an exclusion, consistent with feat-590.

## Constraints

Astra through the existing coding subscription only. No paid APIs, fallback credits, keyword/similarity/embedding shortlist, required profiles or pairwise-judgment framework. Private versioned immutable artifacts and actual once-per-call usage only. Unknown consumption stops further dispatch. Metadata-only videos remain eligible. No public activation or production deployment.

## Verification

Run focused full-library tests, Mastra typecheck and touched-file lint/format. Coordinator admits a complete measured corpus and source IDs before the live subscription pilot. Record real results and usage before estimating the full run; preserve failed receipts and source coverage.

Reading execution supports a bounded `readingConcurrency` of 1 or 2. Pilot concurrency is 2; every batch retains its own reservation and usage receipt. Stop further dispatch on failure, settle in-flight calls and pause before global ranking. Delayed fake-call tests verify overlap, the concurrency ceiling, unique batches, deterministic ranking input and failure settlement.

Reading/shared output schemas constrain IDs to exactly the supplied source/target sets and acknowledgement lengths. Plan/dispatch measure actual dynamic schemas, preserving full target coverage and exact postvalidation. No per-reading connection cap or target shortlist. The family-corrected pilot required a fresh plan/run across all 1031 targets: previous instructions wrongly excluded valid family relationships. Preserve original artifacts and known/unknown usage separately; no recovery import. That attempt used overhead 15000/output 28400, timeout 900000ms, concurrency 2, unchanged conservative context ceilings and the same 3 admitted sources. Global ranking still receives every discovered connection.

The completed family-corrected three-source pilot returned 24 supported final results but exactly eight discoveries/source in all nine reads: operator tasks were embedded as untrusted data while trusted common instructions specified a final count. Preserve its artifacts/usage without claiming uncapped discovery compliance. Move phase directives to trusted system instructions, keep payload data-only and untrusted, and remove final counts from common/discovery instructions. Bind and measure exact phase envelopes plus dynamic schemas. Allow a boolean completeness flag; false preserves known physical response/usage and pauses before coverage/ranking after in-flight settlement, without retry. Verify this boundary with `full-library-v1.instructions.test.ts`. Next admitted verification is one source, `cmp787v3r05eoqm01rgaq2yug`, across all 1031 targets in a fresh trusted-stage attempt with unchanged conservative limits. Full-run projections remain conditional on new uncapped evidence; historical unknown usage remains unknown.
