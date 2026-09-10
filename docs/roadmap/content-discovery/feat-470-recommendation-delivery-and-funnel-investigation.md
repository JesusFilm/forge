---
id: "feat-470"
title: "Investigate and repair recommendation retrieval timeouts"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-09-09"
duration: 3
depends_on: []
blocks: []
tags:
  - "recommendations"
  - "watch"
  - "analytics"
---

## Problem

Recommendation retrieval can time out despite compatible candidates being available: a bounded production diagnostic was canceled at 2,500 ms. This ticket owns retrieval reliability. Playback evidence stays with `feat-369`/`feat-370` and below-player visibility with `feat-373`. Language coverage and a fair personalization comparison are separate follow-ups. Viewer-usage analytics remain in the local assessment rather than this public ticket.

## Entry Points — Read These First

1. `docs/plans/2026-09-09-fix-recommendation-retrieval-plan.md` — bounded repair scope and verification.
2. `docs/reports/2026-09-09-recommendation-retrieval-verification.md` — reproduction, query plans, and validation.
3. `apps/admin/src/services/recommendations/delivery-retriever.ts` — `nearest_chunks` and the active-contract predicate inside the ANN probe.
4. `apps/admin/src/services/content-embedding-contract.ts` — `activeTranscriptContentEmbeddingWhere`, exact parent/chunk provenance authority.
5. `apps/admin/src/services/recommendations/delivery-runtime.ts` — absolute deadline, transaction limits, and candidate pools.
6. `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts` — production-shaped retrieval fixture and latency assertions.
7. `docs/solutions/performance-issues/semantic-recommendation-retrieval-bounded-pgvector-fanout.md` — prior bounded-fan-out design and warm-cache caveat.

## Grep These

`retrieval_timeout`, `nearest_chunks`, `activeTranscriptContentEmbeddingWhere`, `video_transcript_chunk_embedding_hnsw_en`, `withinDeadline`, `DELIVERY_ISSUANCE_RESERVE_MS`.

## What To Build

1. Reconcile deployment/config history with the local assessment. Compare pre- and post-`eec174a3` query shapes under the same production-shaped statistics; independently consider pool wait, concurrent profile work, and input mix.
2. Preserve a causal diagnostic with query plans and bounded timings for short/long seeds, English/Spanish/French and sparse locales, and cold/warm pools. Planner cost is not elapsed time.
3. If the active-contract join disrupts ANN access, implement an index-compatible query that still admits only the exact active contract and preserves seed/relationship exclusion, exact playable-dub eligibility, deterministic order, and slate quality. Do not move a filter after a fixed candidate cap without proving the resulting recall/fill behavior.
4. Add a realistic database regression case; small synthetic fixtures alone do not establish production index choice or latency. Recheck complete-service time, not only SQL execution.
5. After normal PR-to-main deployment, repeat production timeout/coverage cohorts and compare traffic mix before claiming recovery.

## Investigation Started — September 9

Production `EXPLAIN` for Birth of Jesus / English used `video_transcript_chunk_embedding_hnsw_en` with the pre-`eec174a3` query shape. The original active-contract shape instead used a bitmap heap scan for candidate chunks and parent lookups before sorting nearest neighbors. Total estimated cost rose from 9,397.15 to 22,561.56. A bounded execution completed the earlier query in 171.78 ms; the original active-contract query was canceled at the 2,500 ms statement timeout (`57014`). This establishes a reproducible performance problem, without claiming an exact historical rollout cause.

## Repair Verified — September 9

The repair keeps exact provenance and family-video exclusion inside a scalar parent lookup before the neighbor cap, eliminating all-language transcript expansion. Retrieval transactions use local custom planning and bounded strict iterative scanning. Production SQL samples completed in 25.819–198.552 ms. The restored 280,107-vector snapshot returned six cards with complete semantic delivery at 308/185 ms cold/warm and hybrid delivery at 279/252 ms. Nine deterministic database regressions pass, including actual indexed contract-skew retrieval and settings cleanup. Details and boundaries are in `docs/reports/2026-09-09-recommendation-retrieval-verification.md`.

Implementation is ready for the normal PR flow. This ticket remains in progress for deployment and post-deploy timeout/fill measurement; local verification does not establish production recovery or helpfulness.

## Constraints

Read-only production investigation; no deployment, configuration change, index DDL, or embedding mutation from this investigation. Preserve the exact content embedding contract and unchanged 1.5-second end-to-end delivery budget. Keep Web and GraphQL contracts unchanged unless separately justified. No raw vectors or viewer identifiers in diagnostics.

## Verification

Compare query plans and result eligibility against a representative restored database. Run focused retriever/runtime tests and the real-DB delivery suite in its disposable fixture. A repaired implementation needs affected Admin lint/typecheck and a production-shaped latency/quality comparison, then normal PR validation. This ticket remains in progress until remediation and post-deploy evidence are complete.

## Branch Scope

This repair is independently reviewable on current main. The earlier analysis and proposed experiment/locale tickets remain in the originating task checkout; they are context, not implementation dependencies or part of this repair PR.
