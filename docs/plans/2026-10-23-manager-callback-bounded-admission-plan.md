---
title: "PR 1087 callback admission and integration correction"
type: fix
status: complete
date: 2026-10-23
related_feature: feat-909
---

## Scope

Correct S2 in Manager callback admission and integrate the existing Manager/Mastra runtime seam with current main. Preserve the original Phase 1 product boundary: no graph port, rollout, schema change, provider calls, or production mutation.

## Plan and work

1. Verify native isolation and exact branch/head; reproduce the expired-log Manager CI failure locally with dummy configuration.
2. Merge `aa3c8fe7a32c82661a7296c90ca64a5ff6109f20` into the PR branch without rewriting history. Reconcile state/options, API validation, workflow steps, Mastra registrations/configuration, flags, and dependency changes individually.
3. Bound pre-auth rate-limit key parsing, retained buckets, and expiration. Keep active rate windows effective when new identities reach capacity; expiry must release unused identities. Treat forwarded headers as untrusted unless the deployment boundary establishes provenance; they never authorize callbacks.
4. Add deterministic invalid-bearer floods, capacity and expiry tests plus header shape tests; preserve all auth, body, job, and engine regressions.
5. Run meaningful full resulting scope validation and a local code review, compound durable resource-bound guidance, and save an independent-review packet. Independent review and publication belong to the parent task.

## Review constraints

Use only dummy inputs and owned `/mnt` dependencies/cache/temp/build/evidence. A local test does not establish edge header spoofing or production exhaustion. Record unavailable historical CI logs and distinguish reproduced defects from inferred historical causes.

## Local review outcome

S2 correction bounds header parsing, retained cardinality, and lazy expiry. Dummy invalid-bearer tests cover distinct keys, capacity exhaustion without active-window eviction, entirely new keys across four expired windows, malformed/oversized addresses, and default-untrusted forwarded headers. Authentication and callback job/engine/run/sequence/terminal-state gates remain in place.

The original Manager test suite reproduced a collection failure from the mock-mode enrich route importing the server-only engine resolver. Test-only resolver mocks preserve that production boundary; current-main reviewer denial tests also assert the resolver is never called on denial. Historical Actions logs had expired (HTTP 410), so the local reproduction diagnoses a concrete defect without claiming the archived failure text was recovered.

Normal integration reconciles 14 conflict paths and retains main's custom job options, step inventory, source materialization omission semantics, Mastra registrations and dependency graph. R1 full Manager, Mastra, and feature-flag tests, all three typechecks and strict lint checks, full repository formatting, and the Manager production build passed; that build is inherited R1 evidence only. The private packet records exact commands and remaining validation qualifications. Mastra's build CLI always installs generated output dependencies without a frozen lock and performs temporary directory moves; it was not run under this assignment's frozen-install/no-move constraints. No rendering, hydration, or client initialization changes remain relative to current main.

Implementation self-review and both independent rounds are recorded. The parent accepted the independent R2 bounded source review of `567a83e8066028dc6c4ba0bd9065c1335331084f` (tree `8662e03f9d85c3e83fd625aa89e1386ea2708cb3`) on 2026-10-24. feat-909 and this repair plan are complete for that scope.

## Bounded correction round 2 — independent findings

Independent review rejected candidate `86d9dc7cc31aa2b5c70e062423bee2d3c51b354b` on four P2 findings. Keep the integrated main `aa3c8fe7a32c82661a7296c90ca64a5ff6109f20` and original S2 admission bounds.

1. Serialize `restampEngine` and `markEnrichmentDispatched` on `serializeJobUpdate` in `apps/manager/src/lib/state.ts`. Add a queued rerun reset that retires `currentRunId`, `dispatchedAt`, and callback sequences atomically with pending steps. Test callback/watchdog before and after dispatch/reset/restamp using held Admin snapshots and whole-options replacement. Preserve siblings and materialization omission semantics; no distributed redesign.
2. Accept optional `videoTitle` in Mastra's strict enrichment input. Exercise the full current Manager caller shape through accept/start/workflow handoff; preserve the unimplemented graph.
3. Align the local Mastra callback step inventory, including `structured_transcript`, with Manager using shared data fixtures and independent local schemas. Enumerate every step/status and strict invalid payloads without cross-app imports.
4. Return retryable 503 without launch on null/error/mismatched engine restamping. Prove successful selected-engine persistence before launch and rollback stamp survival under concurrent old callbacks/watchdogs.

Run focused regressions first, then full affected suites, typechecks/strict lint, format, hooks, commitlint and roadmap checks. Keep all new substantial evidence/cache/temp in private `1087-implementation-r2/`; reuse pinned Node/dependencies, no installs. Inspect supported safe Mastra build paths read-only; retain explicit unrun qualification if none meets constraints. Record a local code commit and exact-head review packet; no push or independent acceptance in this round. That round kept feat-909 in progress until parent acceptance.

## Parent acceptance and publication boundary — 2026-10-24

All four P2 findings are resolved. R2 implementation tests record Manager 1,457 passed/3 skipped, Mastra 3,915 passed/45 skipped, and feature flags 23 passed; independent R2 review ran 141 fresh focused checks. Parent-authorized normal publication obtains exact-head CI without further source changes or main integration.

Merge readiness remains qualified until exact published-head CI/build checks are assessed. Manager needs a current-head production build; R1 build evidence is inherited. Mastra generated-output build remains locally UNRUN under the frozen-install/no-move constraints. Native-image PostgreSQL/DuckDB startup and existing DB/provider skip gates remain unverified. This is not blanket security clearance.

Keep the Phase 1 graph explicitly unimplemented and the feature flag/ramp default-off. Before real callback traffic, require owner disposition of shared-bucket availability/throughput. Cloudflare address partition trust additionally requires verified header overwrite and no direct-origin bypass. No activation, merge, deployment, or production validation is included.
