---
title: "Remove transcript compatibility join fan-out from cold Watch search"
date: 2026-10-23
status: completed
---

## Scope

Continue feat-678 after the owner approved a performance fix. The production
projection table is empty. The fallback compatibility query scans 164,700
transcripts and probes the chunk index 164,700 times, sorting 280,107 joined
rows. A read-only EXPLAIN ANALYZE measured 1,102 ms. An equivalent version-first
existence query returned the same result in 36 ms with one chunk-index probe.

## Implementation

1. Add PostgreSQL integration coverage at the real compatibility resolver.
   Preserve all parent/chunk provenance predicates, null-safe transform and
   version comparison, no-result refusal, mixed-version refusal, and validation
   of the active contract. Assert bounded chunk work on a multi-chunk corpus;
   show the performance regression failing before changing the query.
2. Select distinct compatible parent versions before checking for the existence
   of a qualifying chunk per version. Do not materialize the entire transcript
   candidate set or scan every chunk just to establish existence.
3. Retain the separately tested latency-accounting correction. No ranking,
   deadline, cache freshness, publication, schema or pool-size change.
4. Run focused unit/database tests, scoped types/lint/format, and sequential
   review. Record read-only production plan evidence and local regression
   results. Add the new database test to the existing Watch CI job.

## Boundaries And Remaining Work

No production data/config writes, deployment shortcut, or synthetic load.
Do not fabricate a stored projection or enable the publication worker to avoid
the fallback. A normal PR-to-main deployment and post-deploy cold/warm search
checks are necessary before claiming availability restored. Shared pool
pressure and other timeout stages remain distinct from this measured query
cost. Monitor creation and notification delivery need separate verification.
