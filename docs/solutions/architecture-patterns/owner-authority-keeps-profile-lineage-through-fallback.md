---
title: "Keep final profile lineage checks when a direct release falls back"
date: "2026-09-30"
category: "architecture-patterns"
module: "Admin recommendations"
problem_type: "concurrency_issue"
component: "service_object"
severity: "high"
tags: [recommendations, cowatch, privacy, fallback, postgres, locking]
---

# Keep final profile lineage checks when a direct release falls back

Direct owner approval can replace study prerequisites without replacing source
integrity or privacy enforcement. In feat-565, graph authority and profile
lineage had different dependencies: an interest could derive from an outcome
older than the graph's seven-day source window. A source revision after
composition therefore left the selected graph valid while making the profile
projection ineligible. Locking only the selected graph and the profile's published
projection did not close that race.

`promotion/owner-authority.ts::lockOwnerProfileForIssuance` now fences the exact
profile, receipt, projection and bounded contribution roots, then re-evaluates
`profiles/profile-lineage.ts::profileLineageEligibleSql` through request commit.
Root locks also serialize appended eligibility/conflict/fact rows through their
foreign keys. Source-owner authority and the singleton influence floor participate
in the same final check. The bound is the existing 64 contributions, not a global
source scan.

The same fence is required when graph/MMR fails and delivery retains an already
prepared personalized incumbent. Testing only successful direct composition misses
this route: `ownerInfluence=false` does not mean the fallback contains no profile
influence. Reuse the profile fence without requiring the failed graph to remain
valid. Invalid profile lineage refuses issuance; ordinary graph expiry can still
serve a valid incumbent.

Use fail-fast row locks for this final validation. Graph qualification locks a
graph before reading the promotion pointer, while legacy emergency stop holds the
pointer before its slate-fence trigger locks affected graphs. Waiting in both
orders deadlocks. `FOR SHARE NOWAIT` on qualification/final authority lets the
attempt refuse and releases its graph so emergency stop can finish.

Native regression cases must keep the selected graph and owner release valid
while changing a different profile source after real composition and before real
fallback issuance. Assert no request is persisted. A separate two-connection case
holds the real graph lock until real emergency stop reaches its pointer/trigger
boundary, then asserts qualification refuses and stop commits. Mocks alone do not
prove these foreign-key and trigger interactions.

See `docs/operations/recommendation-owner-live-activation-2026-09-30.md` and
`apps/admin/src/services/recommendations/promotion/owner-authority.db.test.ts`,
`delivery-owner.db.test.ts`, and `promotion/owner-stop-lock.db.test.ts`.
