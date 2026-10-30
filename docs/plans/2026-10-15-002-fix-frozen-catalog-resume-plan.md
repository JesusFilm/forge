---
title: "fix: Resume unchanged catalog content after sync"
type: fix
status: active
date: 2026-10-15
---

# Resume unchanged catalog content after sync

The October 14 sync advanced timestamps after the generation cutoff. All 1,031
profile identities, the selected corpus and the candidate pool still match. The
saved original catalog also matches the sealed GA route mapping. Resume from
those verified inputs without resetting completed work or weakening content checks.

## Requirements

- R1: Permit an explicit local resume from a bounded, SHA-256 verified catalog
  file bound to the generation, input digest and original cutoff. Validate complete
  selected chunks and preserve the existing corpus, candidate and GA checks.
- R2: At Admin's edge persistence boundaries, permit timestamp changes only when
  every requested video's current content matches its single ready v6 profile in
  that same protocol-4 generation. Verify current watchability, complete selected
  transcripts, metadata, chunk bytes and counts. Reject changed or missing content.
- R3: Keep ordinary catalog reads and legacy generation fences strict. Preserve
  original timestamps, all receipts, unknown calls, route history and full profiles.
- R4: Prove a real paused build resumes through native Admin after a sync-only
  timestamp change, while content changes fail. Ship by PR and main before resuming.

## Work

1. Add a local frozen catalog reader and resume-only command configuration in
   `apps/mastra/src/services/precomputed-recommendations/frozen-catalog.ts` and
   `apps/mastra/src/scripts/run-manual-subscription-catalog.ts`. Test file integrity,
   scope, paging, complete selection and configuration before model admission.
2. Add generation-bound ready-profile validation beside Admin's existing catalog
   projection, and use it at edge span validation/finalization and ready metadata
   registration. Leave the original timestamp-only reader unchanged.
3. Extend the native catalog integration test with saved inputs, sync timestamps,
   profile reuse and rejected content mutations. Run affected unit/native tests,
   both app type checks, lint, formatting and review.
4. After normal deployment, verify exact release/configuration and resume the
   existing generation with paced requests, observing saved comparisons. Complete
   the separate seven-unknown-call recovery before closing feat-590.

## Boundaries

This does not activate public serving or qualify changed route mappings. The local
snapshot retains the route identities used by the already sealed historical import;
current playback eligibility remains an Admin check. File contents stay private.
