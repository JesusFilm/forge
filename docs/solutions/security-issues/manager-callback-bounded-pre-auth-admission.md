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
