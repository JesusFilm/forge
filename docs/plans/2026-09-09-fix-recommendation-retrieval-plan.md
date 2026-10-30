---
title: "Preserve ANN access for recommendation contract filtering"
type: fix
status: completed
date: 2026-09-09
---

## Problem and scope

`feat-470`: the current recommendation query joins parent transcript/active-contract provenance inside every nearest-neighbor probe. A production English example changed from HNSW access (171.78 ms under the earlier query) to a bitmap scan/distance sort and exceeded 2,500 ms. Historical deployment attribution is not required to repair this reproduced query problem. Viewer-usage analytics remain outside this public implementation report.

Scope is Admin recommendation retrieval and directly necessary query settings/tests. Preserve response shape, complete-service deadline (1,500 ms), fan-out, source exclusions, exact active parent/chunk embedding contract, exact audio-language/playability, deterministic composition, and privacy. No production schema/config/data changes, frontend redesign, language-coverage expansion, or unrelated shared retriever refactor.

## Decisions and implementation units

### U1 — Reproduce and measure

Owner: primary agent. Use a dedicated worktree and PostgreSQL 18/pgvector container. Restore an approved content/search snapshot when available; never run fixtures/migrations against production or the other agent's database. Capture emitted query plans and timings with representative statistics. The red condition is loss of ANN access and deadline failure; planner cost is not elapsed time.

### U2 — Preserve compatibility within ANN retrieval

Owner: primary agent. File: `apps/admin/src/services/recommendations/delivery-retriever.ts`. Use a correlated scalar boolean parent lookup that reuses `activeTranscriptContentEmbeddingWhere`. Parent primary-key cardinality makes the scalar safe; absent/incompatible parent yields null and fails the filter before the neighbor cap. Apply seed/parent/child exclusions against the small video-ID set inside that lookup instead of materializing every related transcript across languages. Verify that PostgreSQL retains ordered HNSW access rather than pulling the guard into a filtering semijoin. Do not remove contract validation or filter mismatches only after a fixed cap.

Keep `plan_cache_mode=force_custom_plan`, `hnsw.iterative_scan=strict_order`, and `hnsw.max_scan_tuples=20000` local to the existing deadline-scoped transaction in `delivery-runtime.ts`. Production prepared-query checks switched to a generic non-ANN plan on the sixth execution; indexed contract-skew tests returned zero eligible targets with iterative scanning off and ten with strict scanning. Check affected profile retrieval because the settings are shared. No global planner forcing or raised timeout.

### U3 — Regression coverage

Owner: test agent. File: `apps/admin/src/services/recommendations/delivery-retriever.db.test.ts`. More than 48 closer incompatible chunks must not displace six farther valid targets; vary parent and chunk provenance. Existing synthetic 20-vector fixtures cannot establish planner performance. Add meaningful indexed/cardinality evidence where feasible, and retain production-shaped benchmarking separately. Missing pointer/seed, wrong audio, relationships, restricted/unpublished/deleted content, and exact transform identity must remain safe.

### U4 — Verification and review

Run focused retriever/runtime/contract and delivery tests, real database semantic/hybrid complete-service checks, Admin lint/typecheck, and formatting. Compare multiple seeds, en/es/fr plus sparse locale, repeated/prepared and fresh-service cases; keep lower recall/fill distinct from faster execution. Get independent correctness/performance review and resolve actionable findings. Record measurements/limitations and durable planner insight. Deliver a reviewable branch through the normal PR workflow; keep production rollout and post-deploy measurement pending until that flow completes.

## Acceptance

A representative restored dataset reproduces the slow baseline and demonstrates an index-compatible repair within the existing complete-service budget for tested cases; exact provenance and eligibility regressions pass. No generated GraphQL artifact change is expected. If representative data cannot be restored, document the precise limitation and do not substitute synthetic timing as production-scale proof.
