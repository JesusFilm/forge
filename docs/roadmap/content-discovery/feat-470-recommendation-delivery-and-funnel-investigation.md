---
id: "feat-470"
title: "Investigate and repair recommendation retrieval timeouts"
owner: "nisal"
priority: "P0"
status: "complete"
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

Compare query plans and result eligibility against a representative restored database. Run focused retriever/runtime tests and the real-DB delivery suite in its disposable fixture. A repaired implementation needs affected Admin lint/typecheck and a production-shaped latency/quality comparison, then normal PR validation. Closure requires remediation and post-deploy evidence.

## Branch Scope

This repair is independently reviewable on current main. The earlier analysis and proposed experiment/locale tickets remain in the originating task checkout; they are context, not implementation dependencies or part of this repair PR.

## September 21 production review

The repaired retrieval implementation is present in deployed Admin code; the
earlier "ready for the normal PR flow" note is historical. The sustained
[production corpus](../../operations/watch-recommendation-corpus-review-2026-09-21.md)
has persisted retrieval p50/p95/p99 of 96/241/335 ms, maximum 1,246 ms, but that
population excludes requests that fail before issuance. It cannot establish a
zero semantic timeout rate.

Web PR #2352 now emits bounded final delivery-envelope outcomes, preserving
`retrieval_timeout`, `delivery_timeout` and non-timeout coverage reasons
separately. [Release reconciliation](../../operations/watch-ticket-execution-2026-09-21.md)
records exact revision and event/primary-request coverage. At that earlier
checkpoint, sustained complete-service timeout/fill evidence was still pending;
the observation change itself was not a retrieval or selection runtime fix.

## Completed — September 21

PR #2214's repair (`c2af7e75c`) is present in the exact running Admin revision
`de752d60980b25ee11806f2c424770fc78027188`. All nine current deterministic
PostgreSQL regressions pass, including indexed contract-skew retrieval, complete
semantic/hybrid delivery and transaction-setting cleanup. The earlier restored
280,107-vector validation remains representative historical evidence; it was not
repeated by the smaller current fixture.

The fixed **00:15–02:15 UTC** production window has 1,536 primary seeded delivery
requests: 1,088 HTTP 200 and 448 HTTP 403, with no HTTP 5xx. Railway edge counts,
Railway final outcomes and Datadog final outcomes agree exactly, including all
sixteen outcome groups. There are zero `delivery_timeout` and `retrieval_timeout`
envelopes. Coverage, rate-limit and lineage fallbacks remain separately counted.

The [complete release record](../../operations/watch-closeout-release-2026-09-21.md)
compares persisted retrieval latency/fill by UI locale, actual item audio and seed
concentration against the prior 64-hour corpus. The release's 1,075 persisted
requests have retrieval maxima at most 457 ms, but persistence excludes pre-
issuance failures; final-envelope observation supplies that separate boundary.
Different traffic mix and synthetic canaries prevent a causal fill-rate claim.

This closes the reproduced ANN retrieval defect and its deployment/observation
gate. It does not close feat-496's unproven selection delay, feat-497's coverage
expansion, personalization helpfulness or the separate evidence/Admin gates.
