---
module: Recommendation delivery
problem_type: database_issue
tags: [recommendations, pgvector, hnsw, testing]
date: 2026-10-07
---

# Capture the failed filtered HNSW scan before changing recall settings

The delivery fixture has one intermittent case in which an indexed semantic probe returned zero candidates even though an exact scan found 12 eligible videos. A later retry and fresh-index passes do not explain that result. In passing `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans, PostgreSQL attached the provenance/audio subplan to the HNSW index scan and removed about 1,200 rows per seed probe. That observation rules out a blanket claim that the filter is always outside the index; it says nothing about the failed plan.

The failure branch in `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts` keeps the first ANN result as the assertion input. Its separate diagnostic transactions capture an exact eligible count, HNSW scan loops/rows/filter removals and elapsed time from an `EXPLAIN ANALYZE` rerun of the same statement, pgvector version, `work_mem`, `hnsw.ef_search`, `hnsw.max_scan_tuples`, and `hnsw.scan_mem_multiplier`. The rerun is on the same built index but may return a different result; do not call it the original execution's plan. One bounded comparison sets the last parameter to 2 for that transaction only. Probe errors are recorded independently, so they cannot turn the original failed assertion into a pass. The normal 1.5-second retrieval deadline remains in force for every probe.

Reproduction must retain the complete test-file order and a freshly built index before comparing a targeted-only run. On October 7, six complete-file and three targeted-only fresh-schema runs passed on PostgreSQL 18.6/pgvector 0.8.7. The 19-file preceding recommendation CI batch passed 121 tests, and the delivery file still passed on that database without a reset. This bounds the local observation; it does not close feat-609. A future naturally failed actual plan is needed to distinguish a scan-memory stop, tuple limit, graph reachability, or another cause before changing retrieval settings or SQL.

When reusing a worktree dependency tree, check the generated Prisma client against the current schema before interpreting typecheck errors. This worktree's October 2 client still required `ShortSourceSnapshot.trackId`, while current main makes it nullable. Regenerating with Admin's existing `db:generate` in the private worktree restored a passing typecheck without a source change.

Pgvector reference: [iterative index scans](https://github.com/pgvector/pgvector#iterative-index-scans) and [scan options](https://github.com/pgvector/pgvector#iterative-scan-options).
