---
id: "feat-710"
title: "Full-library directional video recommendations"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-16"
duration: 3
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "recommendations"
---

## Problem

Generate private directional recommendations from the complete eligible library, preserving feat-590 results, profiles, usage and checkpoints. The completed pilot has measured private results and generation usage; ticket status tracks independent acceptance.

## Entry Points — Read These First

1. `apps/mastra/src/services/precomputed-recommendations/full-library-v1.ts`: exhaustive planning, evidence validation and durable execution.
2. `apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra.ts`: guarded included-subscription-only Astra transport.
3. `apps/mastra/src/scripts/run-full-library-recommendations.ts`: offline planning and admitted local execution.
4. `docs/plans/2026-10-16-full-library-recommendations.md`: scope and measured pilot.
5. `docs/solutions/workflow-issues/full-library-recommendation-generation.md`: config, commands, accounting and failure handling.

## Grep These

`full-library-v1`, `instructionDigests`, `allWorthwhileConnectionsReturned`, `consumptionUnknown`, `generateReserved`, `validateSelectedChunks`.

## Behavior and Constraints

Measure the exact phase instruction/data envelope and dynamic schema against conservative context and byte caps. Use shared context when it fits; otherwise repeat complete sources in exhaustive target batches. Every eligible video remains available: no keyword/similarity/embedding/top-K gate, required profiles or pairwise-judgment framework. Exclude self and actual duplicate identities (equal nonempty core ID/slug, including alternate Dubs of the same Video). Distinct parents, chapters and siblings remain eligible when useful; family membership alone excludes nothing.

Trusted discovery instructions require all clearly worthwhile connections with no fixed count or shortlist. Only trusted shared/global ranking instructions specify 5–8 final recommendations per source, fewer justified. Untrusted catalog/discovery payloads contain no operator task. Carry all discoveries and immutable explanation/value/evidence into one global ranking in batch order, without latent memory. Validate exact IDs/acknowledgement lengths, duplicate targets, direction, rank and verbatim transcript or explicit metadata evidence. Complete input coverage is not proof of exhaustive reasoning; stop on an oversized global handoff rather than dropping evidence.

Use gpt-6-astra via existing ChatGPT subscription authentication and included allowance only: no paid APIs, credit fallback or resets. Persist private immutable artifacts and actual usage once per physical call. False discovery completeness preserves response/known usage but stops new dispatch, settles peers and pauses before coverage/ranking. Failed/pending/unknown consumption blocks continuation; no automatic retries or recovery imports. Reading concurrency is 1 or 2; CLI timeout defaults to 900000ms, adapter legacy default remains 300000ms. Preserve all prior attempts and their known/unknown accounting.

Code deployment is allowed through normal reviewed PR-to-main flow. No direct Railway deployment or public activation; activation is a separate owner decision.

## Verification and Current Status

Focused tests cover trusted/untrusted phase boundaries, exact schema/envelope measurement and digest binding, evidence/identity/coverage, once-per-call accounting, replay protection, bounded concurrency and failure settlement. Run Mastra typecheck and touched-file lint/format. Independent mechanical and semantic review accepted the completed pilot without blockers.

The completed trusted-stage pilot used one source, How to Forgive Others (`cmp787v3r05eoqm01rgaq2yug`), across all 1,031 videos/1,297 complete selected per-edition transcripts/2,757 chunks, including 114 metadata-only videos. Nine reads returned 249 discoveries; one global rank selected eight recommendations. Ten known physical calls consumed 1,890,507 input/102,005 output tokens (cached input 0; reasoning output 2,812, both subsets), with no failed/unknown current calls. First reservation to final receipt took 1,317.403 seconds (~21.96 minutes), excluding preparation/review and prior attempts. Evidence/results remain private; no old discoveries were imported.

Historical known usage and one unknown-consumption call remain separate in the runbook. These are generation receipts, not all AI usage; legacy and worker/coordinator usage remain separate. Full run not started. Any 1,031-group extrapolation stays conditional, not a forecast/calendar ETA or savings/quality claim. The runbook records the measured settings and accounting. Selection covers declared editions rather than every translation; complete input coverage cannot guarantee exhaustive attention, and ranking cannot recover omitted discoveries.
