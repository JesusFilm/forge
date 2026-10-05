---
title: Recommendation storage closeout and retention acceptance
type: chore
status: active
date: 2026-10-02
---

# Recommendation storage closeout

## Scope

Audit platform feat-554, feat-555, feat-574 and feat-575 against current main and
bounded production evidence. Preserve the already completed legacy reclamation
and the existing 29-day retention. This work owns storage ticket dispositions and
storage-specific evidence; the parent closeout owns shared indexes and merges.

## Method

1. Confirm actual Admin roles, PostgreSQL volume binding, free bytes, relation
   allocation and current compact, packed, shared-vector and first-empty formats
   with aggregate-only read-only checks. Separate file recovery from catalog
   allocation and reusable PostgreSQL pages.
2. Reconcile the normal retention ledger and workflow wrappers by their real
   start/finish times. Count failures, committed roots and descendants, expired
   backlog, lock skips and capacity. A recovered or empty cycle is not
   failure-free loaded acceptance.
3. Map U1–U3 to merged code, native database measurements and deployed new-write
   observations. State where production savings or steady monthly growth remain
   unmeasured. Keep unsafe index/schema rewrites out of scope.
4. Prepare a separate reviewed repair PR only if a reproducible retention failure
   has a bounded code correction. Tell the parent before any live mutation. A code
   repair still requires two later normal loaded cycles for feat-554. Otherwise
   document the exact remaining acceptance gate and keep that ticket open.
5. Mark feat-574 complete only if U1–U3 are genuinely deployed and validated;
   preserve feat-555/575 as complete. Run scoped format and CI-sensitive checks,
   open a storage-only PR, and leave merge coordination to the parent.

## Limits

No old campaign restart, manual retention purge, direct deploy, silent retention
shortening or projected monthly rate from a changing short sample. Request IDs,
viewer information and trace payloads stay out of reports. A normal scheduled
cycle is the only evidence for normal loaded-cycle reliability.
