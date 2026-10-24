---
title: "PR 1087 callback admission and integration correction"
type: fix
status: in-progress
date: 2026-10-23
related_feature: feat-788
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

Normal integration reconciles 14 conflict paths and retains main's custom job options, step inventory, source materialization omission semantics, Mastra registrations and dependency graph. Final full Manager, Mastra, and feature-flag tests, all three typechecks and strict lint passes, full repository formatting, and the Manager production build passed. The private packet records exact commands and remaining validation qualifications. Mastra's build CLI always installs generated output dependencies without a frozen lock and performs temporary directory moves; it was not run under this assignment's frozen-install/no-move constraints. No rendering, hydration, or client initialization changes remain relative to current main.

Implementation self-review is recorded; fresh independent acceptance remains pending. Keep feat-788 and this plan in progress until the parent review accepts the exact local candidate.
