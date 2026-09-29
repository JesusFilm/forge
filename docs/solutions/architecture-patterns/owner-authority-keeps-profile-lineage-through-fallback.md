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

Runtime-backed native fixtures must also use the current schema. A fixed old
migration list can fail on columns selected by today's Prisma client or shared
lineage predicate before a concurrency test releases its latch; the reported
timeout then hides a missing-column error. Use
`current-schema.test-fixture.ts::recommendationRuntimeMigrationSql` for these
fixtures, while preserving explicitly historical migration-upgrade tests. Inspect
rejected background promises before changing a concurrency timeout.

See `docs/operations/recommendation-owner-live-activation-2026-09-30.md` and
`apps/admin/src/services/recommendations/promotion/owner-authority.db.test.ts`,
`delivery-owner.db.test.ts`, and `promotion/owner-stop-lock.db.test.ts`.

## Bind publication to the measured population

A historical event cutoff freezes event membership, but current integrity
classification can still change eligibility. Treat a read-only preflight as an
observation. Check its exact graph generation, source scope, row-count ceilings
and encoded-width ceilings inside the publisher transaction before its first
insert. Keep the existing global work bounds and statement/transaction deadlines.
Measure the actual atomic publisher at a dominating synthetic shape; batch count
also matters when the operator is remote because each batch adds network latency.
Use the reviewed deployed CLI near the database when WAN round trips exceed the
budget, preserving revision checks and aggregate-only output.

## Fixed event windows still have moving identity inputs

The first production publication refused two exact generations while all aggregate
counts stayed equal. A fixed event cutoff does not freeze current profile-session
links, privacy state, or integrity decisions. Discovery links last 24 hours and
`loadCowatchSourceRows` evaluates them at the operation's current wall clock; the
graph hash includes the resulting viewer identity. Before the first graph exists,
there is no retained durable ownership to recover when a discovery link expires.

To isolate this from nondeterministic computation, use one bounded READ ONLY
RepeatableRead snapshot and compare the same deployed source reader with two
explicit wall clocks. Rebuild identical loaded inputs to test determinism, and
compare eligible source components in memory. Retain aggregate change counts only.
The production diagnostic found three profile-to-session changes and unchanged
membership/counts; repeated builds were deterministic. The earlier-clock hash did
not reproduce the historical preflight hash, so intervening metadata changes
remained unresolved. A current snapshot cannot reconstruct historical metadata.

Review a finite conditional handoff before execution: one complete fresh preflight,
exact original window, every count and encoded-width ceiling unchanged, then at
most one immediate publication pinned to that observed fingerprint. Preserve the
publisher's in-transaction exact-generation recheck, operation claims, deadlines
and fail-closed handling. If it refuses or acknowledgement is uncertain, stop and
reconcile; do not loop through new fingerprints or shorten the source window.
This removes manual dispatch delay without weakening source integrity. Deployed
source imports used by an inline diagnostic must handle the Admin package's
CommonJS default export under tsx; a fake ESM fixture alone missed that boundary.

Published durable graph lineage retains captured owner/privacy generation beyond
discovery-link cleanup. That differs from the initial handoff's moving identity
lookup, and from the owner release's 24-hour freshness deadline. Report release
expiry, underlying graph retention, source expiry, natural issuance and human
exposure as separate facts.
