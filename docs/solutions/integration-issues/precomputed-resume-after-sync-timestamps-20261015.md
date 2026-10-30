---
title: "Resume frozen recommendations after timestamp-only catalog sync"
date: "2026-10-15"
category: integration-issues
module: "Precomputed recommendation generation"
problem_type: integration_issue
component: service_object
symptoms:
  - "Catalog resume returns stale_cutoff before any model call"
  - "Current profile identities match despite later catalog timestamps"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [precomputed, recommendations, catalog-sync, frozen-inputs, profiles]
---

# Resume frozen recommendations after timestamp-only catalog sync

## Problem

A long generation crossed a nightly Core sync. Timestamp fencing rejected its
original cutoff even though all 1,031 profiled content identities still matched.
Restarting the model producer could not get past catalog preflight.

## Investigation

Reducing concurrency did not address this failure: the catalog returned HTTP 409
before model admission. Read-only comparison established matching profile keys,
selected corpus and candidate pool. Current route identity had changed, so using
current video objects would also invalidate the sealed historical import. The
saved original catalog retained its exact route digest.

## Solution

`apps/mastra/src/services/precomputed-recommendations/frozen-catalog.ts` reads a
bounded, SHA-256 pinned local snapshot only for an explicit resume. Bind it to
the original generation, input digest and cutoff. Preserve original video/route
objects and complete selected chunks; retain the existing preflight and GA import
checks. Do not adjust production timestamps, the cutoff, model or profile format.

`assertPrecomputedProfileVersion` in Admin's precomputed `catalog.ts` compares
current metadata and all selected chunk bytes against the same generation's ready
v6 profiles at edge persistence and ready metadata registration. It also checks
counts, complete chunk indices and current watchability. Always compare ready v6
content: a hard deletion can leave no later timestamp for the old fence to find.
Legacy inputs and ordinary catalog discovery keep their original strict fence.

The content hash deliberately excludes playback route observations. Those are
preserved by the frozen catalog and the sealed GA import; live playback eligibility
is independently checked. A reusable profile does not certify public readiness.

## Verification and prevention

- The native catalog integration test resumes an applied checkpoint through
  finalization after timestamp-only sync, with no new profile or edge model calls.
- The native edge test uses the real producer planner, rejects changed text outside
  the quoted span, changed titles, blocked playback, deleted chunks and mismatched
  generation/cutoff, then persists the exact Spanish passage.
- The file reader tests hash/scope failures, incomplete chunks, paging, mutation
  isolation and oversized files. Keep snapshot bytes private.
- Distinguish content identity, historical route identity and current eligibility
  when diagnosing future resumes. Test each at its owning boundary.

See [operator procedure](../../operations/precomputed-catalog-build.md) and
[evidence boundaries](../conventions/recommendation-closeout-evidence-boundaries-20261002.md).
