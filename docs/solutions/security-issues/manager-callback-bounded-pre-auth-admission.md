---
module: apps/manager
problem_type: security_issue
component: enrichment_callback
tags:
  - manager
  - rate-limiting
  - resource-bounds
  - proxy-trust
related_features:
  - feat-788
---

# Bounded callback admission before authentication

A process-local rate limiter can reject every invalid bearer correctly while
retaining unlimited caller keys. Resetting an expired key only when that same
key returns does not release identities that never return.

Manager callback admission now bounds three independent resources:

- Address input: at most 45 characters and a single valid IP literal, with
  scoped IPv6 addresses rejected and equivalent IPv6 forms canonicalized.
- Retained identities: at most 1024 buckets, including the shared fallback.
- Lifetime: fixed 60-second windows, with all expired identities pruned on the
  next request, including identities that never return.

The 120-request allowance stays before bearer validation and body parsing. At
capacity, reject new identities until the earliest expiry; evicting active
buckets would let churn reset another caller's admission limit. Cleanup scans
are bounded by the same cardinality cap and require no timer.

Header syntax does not prove proxy provenance. A standard Request does not
expose an authenticated peer address. Internal or unverified ingress therefore
uses one shared bucket by default. Cloudflare address partitions require the
explicit `ENRICHMENT_CALLBACK_TRUST_CF_CONNECTING_IP=true` setting and an ingress
that overwrites `CF-Connecting-IP` and prevents direct-origin bypass. Generic
forwarded headers never enable per-address partitions. No header grants bearer,
job, engine, or run authority. Keep the default unless those deployment
conditions have been independently established.

Regression tests use dummy invalid bearers and documentation IPs, inspect
retained cardinality, exhaust the table, verify active buckets survive churn,
and advance time across several windows using entirely different identities.
This demonstrates the local resource invariant. It does not establish header
spoofing through Cloudflare, a production exhaustion incident, or distributed
rate-limit correctness. Limits remain per process and cleanup remains lazy.

Integration also needs a full package test run: the original PR's mock-mode
job-creation test imported a server-only feature-flag resolver and failed before
collecting its test. Mocking that dependency in the test preserves the server
boundary. Semantic integration must preserve current job discriminators and
step inventories as well as the new engine/run metadata.

## Run ownership and contract correction after independent review

A callback run-id check is effective only when every writer that changes run ownership shares its read/write queue. Admin replaces the whole `options` value. An old callback or first-callback watchdog that has read before an unlocked dispatch can restore old options or fail the newly dispatched job, even with one process.

`apps/manager/src/lib/state.ts` serializes engine restamping, new dispatch persistence, callbacks, watchdogs, and rerun reset on the existing per-job queue. `resetEnrichmentForRerun` retires the old run id, dispatch time, and callback sequences in the same write that resets visible steps. Callbacks arriving between reset and launch consequently fail the run fence. Keep sibling options and omitted materialization fields intact. `state.run-ownership.test.ts` holds one Admin read, starts the competing operation, then releases the read before awaiting both operations; this exposes unlocked writes and also permits a correct queued implementation to finish. It covers both orderings for callbacks/watchdogs against dispatch, reset, and rollback restamping. This remains process-local serialization, not distributed fencing.

The rerun route must stop if engine persistence returns null, throws, or returns a stamp different from the selected engine. Falling back to the pre-stamp job can silently dispatch with the previous engine, including defeating a workflow rollback. Return a retryable failure without launching. State tests model Admin's whole-options replacement; route tests distinguish success from persistence failure and check launch ordering.

Strict local HTTP schemas must track the complete current producer shape. Mastra accepts Manager's optional `videoTitle` and preserves it through accept/start; it also accepts `structured_transcript` callbacks. `docs/fixtures/manager-enrichment-steps.json` pins the full inventory through both app-local schemas without cross-app imports. Per-step tests cover every allowed status plus strict invalid fields/artifact shapes. The Phase 1 graph is still explicitly unimplemented, and all ramp gates remain default-off.
