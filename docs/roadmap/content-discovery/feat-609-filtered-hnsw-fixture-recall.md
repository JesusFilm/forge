---
id: "feat-609"
title: "Diagnose intermittent filtered HNSW recommendation fixture recall"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-10-06"
duration: 2
depends_on: []
blocks: []
tags: [admin, recommendations, pgvector, testing]
---

## Problem

Post-merge [Forge CI run 37387086276, original job 112023214188](https://github.com/JesusFilm/forge/actions/runs/37387086276/job/112023214188) failed the six-card indexed assertion in `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts`: ANN returned zero while the same deterministic fixture's exact diagnostic found 12 eligible videos. A retry passed; that does not fix the intermittent failure. This is separate from feat-554 retention acceptance and does not establish a production retrieval defect. The assertion also failed in earlier #2551 CI; #2580 did not change retrieval source and its retention fixtures use separate databases. The consolidated [release record](../../reports/2026-10-02-recommendation-roadmap-closeout.md) preserves the separate retention deployment evidence.

Bounded October 6 investigation on main `0cb08416c`: eight fresh-schema PostgreSQL 18.6 / pgvector 0.8.7 runs passed unchanged. Actual HNSW plans showed eight loops, ten returned rows per loop, and 1,197–1,199 rows removed per loop, with `Filter: ((embedding IS NOT NULL) AND (SubPlan 6))` attached to the index scan. This disproves a blanket filter-outside-index explanation for those passing executions, but not a distinct failed CI plan. Four later attempts failed during setup on local host `ENOSPC`, before ANN execution. The owned container/volume was removed; no speculative source changes remain.

The failed CI diagnostic recorded `force_custom_plan`, `strict_order`, and max scan tuples 20,000. It lacked an actual failed plan, pgvector version, `ef_search`, `scan_mem_multiplier`, `work_mem`, and stop reason. Memory/tuple limits and index reachability remain hypotheses, not established causes. The successful retry and eight local passes do not close this ticket.

## Entry Points — Read These First

1. `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts` — `fills a six-card slate through HNSW despite nearer incompatible vectors`, `installIndexedContractSkew`, and its failure diagnostic.
2. `apps/admin/src/services/recommendations/delivery-retriever.ts` — `nearest_chunks` ordered ANN probe and exact provenance/audio predicate before the 48-neighbor cap.
3. `apps/admin/src/services/recommendations/delivery-runtime.ts` — transaction-local `force_custom_plan`, strict iterative HNSW scan, 20,000 max scan tuples, and 1.5-second retrieval deadline.
4. Official pgvector documentation: [iterative index scans](https://github.com/pgvector/pgvector#iterative-index-scans) and [iterative scan options](https://github.com/pgvector/pgvector#iterative-scan-options).

## Grep These

`hnsw_fixture_failure_diagnostic|nearest_chunks|hnsw.iterative_scan|hnsw.max_scan_tuples|scan_mem_multiplier|video_transcript_chunk_embedding_hnsw_en`

## What To Build

In an owned isolated PostgreSQL/pgvector fixture, obtain a naturally failing built index without repeated blind CI retries. Capture `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the failed ANN statement, including actual HNSW loops, rows, filter removals, subplan placement and elapsed time. Record pgvector version, `hnsw.ef_search`, `hnsw.scan_mem_multiplier`, `hnsw.max_scan_tuples`, and `work_mem`. Compare repeated queries against that same index with a bounded scan-memory variation and exact eligible count to identify the stopping cause. Implement only a supported targeted fixture or retrieval correction; preserve exact provenance/audio and HNSW execution.

## Constraints

Do not weaken or skip native assertions, widen the 1.5-second budget, disable HNSW, silently fall back to an unbounded exact scan, change production data/configuration, or treat a passing retry as a fix. Preserve publication/playability, privacy, and all existing recommendation eligibility contracts. Do not attach this ticket as a hard dependency to feat-554 or move its accepted retention gate.

## Verification

Run the exact native test repeatedly on owned PostgreSQL 18/pgvector with real HNSW index use confirmed by `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Show that the previously failing index shape returns at least six eligible distinct cards with correct audio/provenance under the existing 1.5-second retrieval bound. Run Admin typecheck, scoped lint/format, and required PR CI. Record passing and failing plan receipts and distinguish fixture evidence from production behavior.
