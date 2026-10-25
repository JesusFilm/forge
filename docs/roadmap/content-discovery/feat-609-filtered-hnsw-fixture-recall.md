---
id: "feat-609"
title: "Diagnose intermittent filtered HNSW recommendation fixture recall"
owner: "nisal"
priority: "P1"
status: "in-progress"
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

October 7 follow-up on main `1daa80373`: an owned PostgreSQL 18.6 / pgvector 0.8.7 database on `/tmp` received the current Admin migrations. Six fresh-schema runs of the complete 16-case delivery file passed (15 executed, one expected opt-in fallback skip each); three targeted HNSW-only runs also passed. The preceding 19-file recommendation migration/service CI command passed 121 tests on that same database, followed without a database reset by another complete delivery-file pass. The HNSW case took 924–1,057 ms in the six initial complete-file runs. None reproduced the ANN-zero result, so these passes establish neither a root cause nor a runtime correction. A failure-only native diagnostic now records actual HNSW rows/loops/filter removals from a same-statement rerun, pgvector and scan settings, and a separate transaction-local 2x scan-memory comparison while preserving the first ANN result as the assertion input and each retrieval deadline. The diagnostic rerun may differ from the first result. Await a natural failure receipt before changing delivery behavior.

October 8 natural failure on PR #2578, integration `403b1a438`: [run 37735282884, job 113173606250](https://github.com/JesusFilm/forge/actions/runs/37735282884/job/113173606250) passed schema generation but failed this native semantic-retrieval gate. ANN returned zero against 12 exact eligible videos. The failure-only diagnostic also returned zero over eight actual HNSW loops with approximately 159 filter removals per loop; pgvector 0.8.7, strict iterative scan, 20,000 tuple cap, `ef_search=40`, `work_mem=4MB`. Its separate 2x scan-memory comparison still returned zero. That comparison does not establish the stopping cause. On matching PostgreSQL 18.6 / pgvector 0.8.7, 11 fresh local targeted indexes and one complete delivery-file run passed unchanged (15 tests, one expected opt-in skip in the complete file). No supported fixture/runtime correction was identified, no assertion was weakened, and no schema artifact changed. The owned diagnostic container was stopped. This ticket remains open; a later passing CI run would not resolve the intermittent recall defect.

October 17 natural recurrence during Studio retention delivery on unchanged
retrieval source, main `96aea48b791230f299c455a08b17276fdd35de5c`:
[run 39013806012, job 117341831985](https://github.com/JesusFilm/forge/actions/runs/39013806012/job/117341831985)
failed the same six-card HNSW assertion at `delivery-retriever.db.test.ts:1899`.
ANN returned zero while exact diagnostics found 96 nearest chunks and 12
eligible videos. The diagnostic HNSW rerun reported eight loops, zero returned
rows, 951 filter removals per loop, 65,504 shared hit blocks and 69.889ms total
execution. Settings were pgvector 0.8.7, `force_custom_plan`, `strict_order`,
20,000 tuples, `ef_search=40`, scan-memory multiplier 1 and `work_mem=4MB`.
The separate expanded scan still returned zero. The preceding PR #2775 CI run
39013099362 passed. One failed-job retry was requested; it cannot close this
existing intermittent-recall ticket or establish a runtime correction. No
retrieval source, fixture assertion or scan setting was changed for Studio.
Railway skipped Manager's deployment after the failed main check, requiring a
fresh normal PR/main delivery after the relevant checks pass.

October 23 recurrence during #2876 CI: [run 39901723572, job 120245057538](https://github.com/JesusFilm/forge/actions/runs/39901723572/job/120245057538) failed `delivery-retriever.db.test.ts:1899` with ANN zero against the six-card minimum; the exact diagnostic found 96 chunks and 12 eligible videos. Settings included pgvector 0.8.7, strict iterative scan, 20,000 scan tuples and `ef_search=40`. A bounded unchanged-head retry passed. No retrieval behavior or assertion changed, and that pass is not a fix or evidence of a production retrieval defect. This ticket remains in progress.

October 23 isolated follow-up on main `a11746ac3`, PostgreSQL 18.6 / pgvector
0.8.7: ten complete-file runs with the unchanged original fixture passed (15
executed, one expected skip per run). On one preserved passing original index,
the production retrieval passed, but an additional HNSW probe filtering only
two target chunk IDs returned zero under `strict_order`; `relaxed_order` and an
exact scan returned both. This narrow probe demonstrates that the synthetic
graph can under-return for a selective filter; it does not reproduce the
production-shaped assertion failure on that index.

A temporary experiment with eight distinct seed directions failed the full
native test: ANN returned zero, exact diagnostics found 96 chunks and 12
eligible videos, and the actual HNSW scan returned zero over eight loops.
Vacuuming before its index build did not prevent another failure, and an
explicit `VACUUM (ANALYZE)` on that same failing index/data did not restore
recall. Rebuilding that _experimental_ index with `ef_construction=200`
returned 96 nearest chunks in an isolated query, suggesting sensitivity to
graph construction but not proving a correction for the original fixture.
The experimental vector geometry was discarded.

One controlled full-file run restored the original geometry and disabled
autovacuum only on its owned fixture table. It passed (15 executed, one
expected skip); afterward that table reported `autovacuum_enabled=false`,
587 estimated dead tuples, and no autovacuum. Dead tuples alone therefore do
not explain the failure, and the earlier same-index recovery observed near an
autovacuum was not a reliable causal result. No fixture or retrieval change
passed the causal bar; the assertion and runtime settings remain unchanged.
The next useful experiment is on a naturally failing **original-geometry**
index: retain it and compare the captured production-shaped statement and
plan against that same index after one controlled index rebuild, with the
original 1.5-second bound and exact eligible count held constant. Keep these
fixture observations separate from production delivery reliability.

October 23 environment comparison after the #2878 cleanup merge:
[passing PR job 120316228230](https://github.com/JesusFilm/forge/actions/runs/39923992470/job/120316228230)
at `b81fa7356` ran the same 16-case deterministic file successfully (15
passed, one expected skip; HNSW case 656ms). [Original main job
120321189312](https://github.com/JesusFilm/forge/actions/runs/39925498078/job/120321189312)
at `85e97f521` failed only the HNSW six-card assertion at 08:40:12 UTC after
the preceding native suites passed. ANN and its diagnostic rerun returned
zero; exact diagnostics found 96 chunks and 12 eligible videos. The actual
HNSW scan had eight loops, zero rows and 150 filter removals per loop;
`force_custom_plan`, `strict_order`, 20,000 scan tuples, `ef_search=40`,
scan-memory multiplier 1 and `work_mem=4MB` were recorded. Doubling scan
memory in a separate bounded run still returned zero.

Both CI job logs identify Ubuntu 24.04.5, runner image
`ubuntu-24.04` version `20261012.334.1`, runner agent 2.338.0, Docker API
1.48, Node 24.22.1 x64, pnpm 9.12.3, Vitest 3.2.4, and a pull of
`pgvector/pgvector:pg18-trixie` at the same digest
`sha256:9d9c930220cb9bf2f956d10a8f909cf9973d9672ca0278aef2c1e6facccad2e0`.
Their PostgreSQL service logs report 18.6 on `x86_64-pc-linux-gnu` from the
same Debian package/compiler string. The failed job measured pgvector 0.8.7;
the passing job did not print the extension version, but used the same pulled
image digest. Both set `RECOMMENDATION_DB_TEST=1` and
`RECOMMENDATION_DELIVERY_DB_FIXTURE=deterministic`. The delivery test,
retriever, and CI workflow files did not differ between those commits.
Observed runner regions differed (`eastus2` for pass, `eastus` for failure),
but neither log records runner CPU model, instruction flags, host kernel or
resolved container image ID. The `ubuntu-latest` migration notice does not
explain this pair: both actual jobs ran Ubuntu 24.04, not 26.

The owned local test host was Linux x86_64 (Xeon Platinum 8268; Linux
7.0.0-38), with Node 24.16.0 and Docker API 1.55. Its inspected local
`pgvector/pgvector:pg18-trixie` image was Linux amd64 at the same digest;
its test diagnostics measured PostgreSQL 18.6 and pgvector 0.8.7. Those
version/digest matches do not establish identical CI host instruction sets.
No observed image/version change separates the passing and failing CI jobs,
and the environment comparison does not identify the recall cause. A next
discriminating experiment needs a naturally failing **original-geometry**
index preserved before teardown: rerun the identical bounded statement on
that index, rebuild only that index against unchanged rows, and compare the
same statement, plan and exact eligible count. A changed result would
implicate graph construction rather than the observed runner image label.

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
