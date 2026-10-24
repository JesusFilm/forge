---
title: "Exclude crawler recommendation traffic before the first write"
date: "2026-09-28"
category: logic-errors
module: "Recommendation delivery traffic admission"
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "Declared crawler requests committed recommendation delivery records."
  - "Experiment and engagement exclusions did not prevent delivery persistence."
  - "Speculative browsing could create delivery or profile state before activation."
root_cause: logic_error
resolution_type: code_fix
tags: [recommendations, crawler, persistence, prerender, postgresql, graphql]
---

# Exclude crawler recommendation traffic before the first write

## Problem

The September 28 production audit found a declared crawler request committing
recommendation records. The existing `eligibleHuman=false` value governed
experiment participation, and the evidence guard protected engagement ingestion.
Neither prevented delivery traces or automatic profile work.

## What did not establish a no-write boundary

Eligibility flags protect only the operations that consume them. Removing a
request ID or capability from the returned response cannot undo an upstream
commit. For You also resolves viewer identity before entering its delivery
service, so guarding the service alone leaves an earlier mutation boundary open.

Treating every speculative request as a bot would also change ordinary visitor
behavior: a browser can prefetch or prerender before the visitor navigates.

## Solution

Web derives a bounded traffic category from request headers before session and
profile-cookie handling. It forwards that category through the authenticated Web
GraphQL contract. Admin validates the caller and branches before identity
resolution, profile linkage, serving state, experiments and persistence in both
seeded and For You delivery. Legacy false eligibility remains exclusionary even
with a contradictory ordinary category.

Recognized crawlers receive public contextual cards, null attribution and the
existing inert capability sentinel. Speculative requests receive an explicit
`deliveryDisposition: "deferred"`; browser delivery and automatic profile
bootstrap wait for activation, then fetch an ordinary delivery. A reused deferred
envelope gets one fresh attempt. Null request IDs alone cannot identify deferred
responses because contextual and unavailable responses also use them.

Origin and input checks, Web rate admission, cancellation, StrictMode cleanup and
privacy withdrawal/deletion stay in place. A missing or browser-looking user agent
is not proof of humanity; this classifies recognized inputs, not all automation.

Bounded observations distinguish attempted, avoided and acknowledged committed
work. Web records an unexpected upstream commit even when it strips attribution
from the response. No new database ledger or raw user-agent/identity fields are
needed to count exclusions.

## Response contracts and proof

Review caught two defects in the first contextual implementation: item positions
started at one rather than zero, and partial seeded slates omitted
`shortfallReason`. Both caused existing browser parsers to reject otherwise valid
cards. Preserve the full transport contract when adding an untracked branch.
Tests now cover actual Admin positions and partial-slate metadata, plus Web
rendering for one, five and six contextual cards.

Disposable PostgreSQL tests install write traps across every recommendation table
while reading real curated inventory. Profile-backed excluded inputs produce no
writes, and normal delivery remains a positive persistence control. Resolver
coverage separately proves that excluded For You requests bypass identity
resolution and discard credentials. Browser fixtures verify activation ordering,
recovery, impression, selection and playback handoff; simulated prerender/BFCache
events are not proof of native browser cache behavior or production latency.

The additive Admin contract must deploy before Web's new shared operation
arguments. Validate old operations against the new schema, verify all active
Admin processes, then release Web. Reverse that order for rollback. Local tests
alone do not prove production exclusion; confirm both fleets and fresh aggregate
observations after release.

## Legacy evidence boundary

Selective conversion is a separate operation. Construct the compact payload in
PostgreSQL and compare reconstructed typed rows in both directions with
`EXCEPT ALL` before deleting the redundant stage rows atomically. JavaScript
serialization is insufficient for exact historical numeric/JSON precision.
Preserve counters, parent/item rows and inherited expiry; freeze quality sample
IDs before conversion changes the legacy sampling population.

A bounded conversion can add compact/TOAST allocation and WAL while the old
stage files remain allocated. DELETE does not promise immediate filesystem
recovery. Follow the [selective conversion runbook](../../operations/legacy-recommendation-trace-conversion.md)
for private manifests, current capacity, parity checks and finite pilots.

## Prevention

- Enumerate every writer before claiming an exclusion prevents persistence,
  including identity resolution and automatic profile bootstrap.
- Test real database side effects and ordinary positive controls alongside
  transport/parser compatibility; mocked browser payloads can conceal drift.
- Keep traffic provenance bounded and authenticated, and deployment ordering
  explicit whenever shared operation documents add arguments.

## Related

- [Recognize crawler product tokens](../security-issues/recognize-crawler-product-tokens-without-documentation-urls.md)
- [A gate bounds only the refreshers it sits on](../architecture-patterns/a-gate-bounds-only-the-refreshers-it-sits-on.md)
- [Trace capacity and retention proof](../best-practices/recommendation-trace-capacity-and-retention-proof-20260928.md)
