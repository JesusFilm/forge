---
title: "Population measurements can repeatedly revoke a co-watch graph"
date: "2026-09-30"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "eligibility_ledger"
severity: "high"
symptoms:
  - "Owner-approved co-watch graphs revoke shortly after activation"
  - "Captured eligibility revisions change while positive decisions stay the same"
root_cause: "logic_error"
resolution_type: "code_fix"
tags: [recommendations, cowatch, integrity, lineage, idempotency]
---

# Population measurements can repeatedly revoke a co-watch graph

## Cause

`apps/admin/src/services/recommendations/integrity.service.ts` recomputes
media-wide support, contribution ordinal and identity concentration. Its complete
classification digest includes these measures. Previously, any digest change
superseded the eligibility revision, even when only ambient measurements changed
and the source retained exactly the same positive contribution.

Co-watch captures exact eligibility revision IDs. Superseding one captured source
invalidates the entire immutable graph and revokes its owner release. This is a
necessary lineage fence; a fresh activation does not remove the producer churn.
Production G4 lasted about 35 minutes and its replacement G5 about 5.5 minutes.
All retained immediate successors examined for both graphs stayed positive with
unchanged effective decisions. Most changed measurements; aggregate history alone
cannot prove that no other evidence changed in the initiating transactions.

## Repair contract

Recompute the current decision first. Only playback sources may reuse a previous
current, unexpired, positive aggregate receipt. Require exact source, policy,
actor, expiry, evidence watermark and effective decision equality. Rehash the
complete current classification input with only the previous stored measures
substituted; reuse is allowed only if that equals the previous input digest.

Return the old receipt unchanged. Do not update its digest, measures or expiry,
weaken the revocation trigger, or replace full-input hashing with verdict-only
hashing. Threshold crossings and non-measure evidence changes still supersede,
even if some other changed evidence happens to produce the same positive verdict.
Selection and content-action classification retain their existing behavior.

## Legacy digest compatibility found on October 1

Generation 6 still revoked after measurement-only reuse shipped. Retained evidence
showed 12 positive eligibility replacements near its revocation. Eight captured
digests exactly reproduced the current input with the previous measures and only
`directInfluenceAllowed` omitted, matching the older serialization. All 12 successor
digests matched the complete current input. The earliest successor preceded graph
invalidation by 11 ms and reproduced this legacy form. This identifies a concrete
producer defect and strongly supports the revocation trigger; timestamps alone do
not reconstruct the invalidating database transaction. Four other captured digests
did not match either representation and must continue to revoke.

The compatibility path accepts only playback input with current
`directInfluenceAllowed === true`. After recomputing the decision and enforcing
every existing source/actor/policy/watermark/expiry/effective-decision guard, try
the modern hash first, then the exact historic serialization with that single
property omitted. No arbitrary hash mismatch, previously explicit `false`, changed
evidence or newly disallowed influence can reuse a receipt. The stored digest,
measures and expiry remain unchanged.

Native regressions use the real producer, publication and invalidation triggers:
modern and legacy measurement changes (including concurrent classifications) retain
the same receipt and authority; threshold crossings and other evidence changes
still revoke. Historic digests are seeded only before graph publication in the
owned fixture. Never repair production by editing a captured receipt or clearing
revocation.

The [sanitized investigation](../../validation/cowatch-restoration-20261001/production-investigation.md)
contains the digest reconstruction, timing, deployed revisions and limits of this
evidence. Separately, missing-theme composition can come from selecting an empty
first transcript chunk or losing metadata when the candidate union selects another
presentation. Fix the bounded exact-video/playback/locale metadata path; do not
infer that a theme fallback invalidated graph authority.

## Verification and remaining work

The regression tests exercise unchanged receipt reuse, threshold crossings,
non-measure evidence and mismatched receipt fields. Native coverage uses actual
producer receipts, graph publication, owner qualification and invalidation
triggers, including concurrent classification. Final validation and deployment
status belongs in the [operation record](../../operations/recommendation-owner-live-activation-2026-09-30.md).

This repair reduces avoidable invalidation; it does not revive already revoked
graphs or provide automatic refresh for legitimate source changes and expiry.
Feat-573 owns continuity. Missing theme metadata is a separate composition
fallback. A configured owner pointer or an HTTP 200 response proves neither
co-watch execution nor useful recommendations; inspect actual served provenance.
