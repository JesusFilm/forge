---
title: "Recommendation evidence transport and crawler integrity"
type: fix
status: active
date: 2026-09-09
origin: docs/roadmap/content-discovery/feat-464-recommendation-evidence-transport-crawler-integrity.md
---

# Recommendation evidence transport and crawler integrity

## Scope and acceptance

Implement feat-464's transport, admission, concurrency and operational evidence fixes.
Preserve the fixed production evidence window in the ticket. The implementation PR
can be reviewed before deployment; feat-464, feat-459 and feat-447 cannot close until
the required production canary and authorized current-pointer audit pass.
No ranking activation, production repair, direct deployment, or changes to issues
2141–2148 are included.

## Decisions

- Normalize returned and rejected Apollo GraphQL errors at a single Web boundary.
  Claims and facts map proven invalid bindings to terminal HTTP 409.
- Evidence gets a 3-second upstream and 5-second complete browser acknowledgement
  budget, based on the recorded 1.91-second successful p95. This is provisional
  operational headroom, not proof of production acceptance. Keep recommendation
  delivery's 1.5-second deadline unchanged.
- Retry ambiguous writes only with the same nonce/event IDs and exact payload.
  Bound acknowledgement bodies as well as response headers. Context issuance has
  no stable client idempotency key and must not gain automatic retries.
- Reuse recognized crawler/prefetch classification before human evidence writes.
  Unknown user agents are not evidence of humanity. Do not claim to detect all bots.
- Preserve Serializable isolation. Avoid waiting with an obsolete transaction
  snapshot by trying the episode advisory lock and retrying busy acquisition outside
  the transaction, under a bounded budget. Keep CAS, privacy and generation fences.
- Observability accepts only fixed enums/counts, never identifiers, raw errors,
  tokens, user agents, histories or vectors. Missing observations are unknown, not zero.

## Implementation units

### U1 — Web transport and machine admission

Files: apps/web/src/lib/recommendations.ts, recommendation-timeouts.ts,
recommendation-mutation-admission.ts; apps/web/src/app/api/recommendations/
routes and colocated tests; apps/web/src/components/recommendations/
RecommendationPlaybackRecorder.tsx, WatchSemanticRecommendations.tsx and tests.

Normalize actual thrown Apollo errors and compatible returned error envelopes;
preserve other errors. Apply crawler rejection to context, claim, facts, initial
evidence and selection before upstream writes. Stop definitive retries without
blocking the player. Extract the existing delivery predicate instead of diverging.

Execution note: test-first for rejected Apollo shapes and stalled acknowledgement.
Test scenarios: rejected CombinedGraphQLErrors, legacy envelopes, unrelated errors,
409 terminal claim/fact, 403 crawler without fallback, one stale-binding fallback,
lost acknowledgement with identical replay, stalled JSON, client abort, known
crawler/prefetch and ordinary/missing UA, spoofed origin. Verify no mutation on
rejected admission and unchanged delivery budget.

### U2 — Database contention and canonical claims

Files: apps/admin/src/services/recommendations/transaction-retry.ts,
episode.service.ts, playback.service.ts, outcome.service.ts and their tests,
including playback-episode.db.test.ts.

Use the existing episode lock key for nonblocking acquisition and bounded retries.
A claim CAS loser revalidates and returns the committed canonical claim; never
manufacture a new capability or relax binding checks.
Execution note: reproduce with real PostgreSQL before fixing.
Test scenarios: eight delayed replay callers, contiguous receipt ordinals, mixed
replay/conflicting/new facts, concurrent finalizer and late facts, eight identical
claims, key rotation, bounded lock exhaustion, nonretryable errors. Each fixture
owns its prerequisites and cleanup. Compare authoritative rebuild to incremental
outcomes and preserve submission accounting outside retry loops.

### U3 — Privacy-safe operational evidence

Files: apps/web/src/lib/recommendation-evidence-observability.ts and tests;
apps/admin/src/services/recommendations/ evidence observability and admin-ops
services/tests; authorized Admin recommendation surface as necessary;
infra/datadog-monitors/ and docs/operations/.

Expose action, outcome, domain reason, timeout stage, retry disposition, database
contention/exhaustion and crawler admission using allowlisted telemetry. Reuse
existing operational infrastructure, bounded retention and aggregate permissions.
Provide dashboard/monitor definitions and a production verification runbook.
Historical window audit must distinguish proven machine evidence from ambiguous
records; never infer episode ownership from aggregate APM counts or mutate evidence.
Test redaction, aggregation availability, authorization, fixed-window semantics
and no observer failure delaying or rejecting playback.

### U4 — Integration, review and release evidence

Run focused and full Admin/Web tests, lints and typechecks; serialized real
PostgreSQL concurrency/lifecycle tests; schema and generated-client drift checks
if contracts change; repository formatting and roadmap checks.
Reconstruct local Watch/Admin setup from repository fixtures and snapshot tooling.
Browser proof covers real playback, emitted receipts, finalized outcomes, Admin
reconciliation and fail-open playback with telemetry unavailable. Measure page-load
impact. Synthetic content can exercise transport but cannot substitute for the
production-vector latency gate or production audit.
Review correctness, API contracts, privacy, concurrency, reliability and tests;
compound durable findings. Open a PR with exact passed/blocked gates.

## Dependencies and execution unknowns

U1 and U2 have disjoint app ownership and can run in parallel. U3 must coordinate
telemetry call sites with both before editing shared files. U4 follows integration.

Inspect available snapshot credentials and restored data without printing secrets.
If production-shaped data or authorized canary access is unavailable, finish all
local implementation and validation and explicitly retain those release gates.
Do not treat a passing local test as deployment, a production canary, or zero
ineligible production pointers. Monitor installation and production changes remain
reviewable artifacts until normal release authorization.

## Review focus

Stress-test bounded contention under long transactions, telemetry failure isolation,
canonical capability reconstruction, rejected Apollo error shapes, crawler admission
coverage, and historical audit uncertainty. Preserve active-watch-proxy-v1's
existing fail-closed live-ranking policy.
