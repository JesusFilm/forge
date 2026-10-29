---
id: "feat-909"
title: "Bound Manager enrichment callback admission state"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "manager"
  - "security"
  - "ai-pipeline"
---

## Problem

PR #1087 retains distinct callback address keys in a process-lifetime Map before bearer rejection. Entries never expire unless the same key returns. S2 identifies a resource bound defect; production exhaustion and address spoofing through Cloudflare are not established.

## Entry Points — Read These First

1. `apps/manager/src/app/api/internal/enrichment-callback/route.ts` — pre-auth admission.
2. `apps/manager/src/app/api/internal/enrichment-callback/route.test.ts` — dummy callback tests.
3. `apps/manager/src/lib/state.run-ownership.test.ts` — callback/watchdog versus dispatch/reset/restamp interleavings.
4. `apps/mastra/src/mastra/workflows/forge-video-enrichment.test.ts` — full current Manager caller shape.
5. `docs/fixtures/manager-enrichment-steps.json` — both app-local callback inventories.
6. `docs/plans/2026-06-01-001-feat-manager-enrichment-mastra-finishable-stages-plan.md` — the 49-file PR intent.

## Grep These

- `callbackRateLimitBuckets|checkCallbackRateLimit|readClientRateLimitKey`
- `currentRunId|callbackSequences|FORGE_ENRICHMENT_MASTRA_RAMP_ENABLED`

## What To Build

Bound retained address length and cardinality, expire unused windows, and document header trust. Preserve cheap admission before bearer validation, body bounds, run fencing, monotonic job transitions, feature flags, and the two-phase handoff. Diagnose the existing Manager test failure and merge current main normally into the PR branch, reconciling each conflict semantically.

## Independent correction round 2

Candidate `86d9dc7cc31aa2b5c70e062423bee2d3c51b354b` was rejected on four P2 findings. Queue ownership-changing state writes with callbacks/watchdogs; atomically retire prior-run metadata on rerun reset; accept/preserve optional `videoTitle`; align the complete callback step vocabulary; and fail closed when selected engine persistence fails. See `docs/plans/2026-10-23-manager-callback-bounded-admission-plan.md` and the compound solution `docs/solutions/security-issues/manager-callback-bounded-pre-auth-admission.md`. The corrective candidate `567a83e8066028dc6c4ba0bd9065c1335331084f` resolves all four findings and preserves original S2 bounds and integrated main. The independent R2 bounded source review accepted that exact candidate; the parent recorded acceptance on 2026-10-24.

## Constraints

The completed scope is the bounded S2 repair, conflict integration, and four independent-review corrections. Local verification used dummy inputs. Parent-authorized normal branch publication obtains exact-head CI; completion does not establish merge or release readiness. No providers, production state, credentials, or activation were used. Related broader pipeline work remains in `feat-031`.

## Verification

Run callback resource-bound and auth/job regression tests; full Manager tests; touched Mastra and feature-flag tests; Manager/Mastra typecheck and strict lint; format, roadmap, diff, and commitlint checks. Record exact heads, merge resolutions, logs, qualifications, and reviewer brief in the private implementation packet.

## Acceptance and release gates — 2026-10-24

Parent acceptance records the independent R2 review of candidate `567a83e8066028dc6c4ba0bd9065c1335331084f`, tree `8662e03f9d85c3e83fd625aa89e1386ea2708cb3`, with all four P2 findings resolved and 141 fresh focused reviewer checks passing. Implementation evidence records Manager 1,457 passed/3 skipped, Mastra 3,915 passed/45 skipped, and feature flags 23 passed. This is bounded source acceptance, not blanket security clearance.

Exact published-head CI and actual build results remain required before assessing merge readiness. Manager production-build evidence is inherited from R1, not the accepted current head. Mastra generated-output build remains locally UNRUN because the supported CLI installs generated dependencies without a frozen output lock and may move temporary node_modules. Unit tests and typechecks do not close those build gaps. Native DuckDB/disposable PostgreSQL image startup, existing DB/provider skip gates, and production/edge behavior remain unverified.

The Phase 1 graph remains explicitly unimplemented; keep the feature flag and Mastra ramp default-off. Before real callback traffic, the owner must disposition the demonstrated shared-bucket availability/throughput limit. Cloudflare address-partition opt-in additionally requires verified header overwrite and no direct-origin bypass. This completion authorizes no activation, merge, or deployment.

## PR1087 admission and callback recovery (2026-10-28)

- New-run dispatch resets terminal steps and errors; repeated same-run dispatch
  preserves terminal state and callback receipts.
- Strict callbacks support correction/raw/canonical and owned-language validation
  artifacts, bounded metadata, 50 language results and 151 artifact keys, keeping
  the 64-KiB body limit. Callback transport retries 429/503 with a finite deadline
  and stops execution on lost ownership acknowledgements.
- Mastra reserves digest-bound run admission durably; starts consume the
  reservation once. Ambiguous starts require explicit recovery.
- A fixed Manager execution bridge claims Admin-owned operations before side
  effects. Root integration supplies the atomic Admin ledger and schema contract;
  the execution graph remains a separate dependent unit, with both flags off.
- See `docs/solutions/security-issues/manager-enrichment-durable-admission.md` for
  the exact contract, PostgreSQL concurrency evidence and remaining integration
  verification boundaries. No new recovery ticket was allocated.
