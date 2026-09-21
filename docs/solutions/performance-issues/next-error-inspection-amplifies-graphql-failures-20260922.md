---
title: "Next error inspection amplifies batched GraphQL failures"
date: "2026-09-22"
category: performance-issues
module: "Admin GraphQL logging"
problem_type: performance_issue
component: service_object
severity: high
symptoms:
  - "One catalog failure produces hundreds of identical Yoga logs"
  - "Unrelated selection and playback operations miss deadlines during error logging"
root_cause: async_timing
resolution_type: code_fix
tags: ["nextjs", "graphql", "logging", "source-maps", "event-loop", "watch"]
---

# Next error inspection amplifies batched GraphQL failures

## Problem

Yoga masks and logs each failed GraphQL field independently. Next 16.2.4's
production Error inspector reparses source maps with a cache scoped to one
inspection. A batched database failure therefore repeats expensive synchronous
work for every affected field, blocking unrelated requests on the same loop.

## Proof and correction

The isolated source-map reproduction only established a possible mechanism.
An actual owned Admin production build, real PostgreSQL error, 206 field errors,
and concurrent real mutations establish the application impact. The control's
selection acknowledgments take roughly 75.8 seconds; the corrected logger takes
135–208 ms across 20 accepted selections. All catalog errors remain masked in
responses and all 206 Yoga errors reach the local log collector in each repeated
fixed run. See the [full reproduction and limits](../../operations/watch-error-formatting-recovery-2026-09-22.md).

Use `createGraphqlLogger()` from `apps/admin/src/graphql/logger.ts`. In production
it formats Error arguments with `inspect(error, { customInspect: false })` before
passing them to Yoga's existing logger. This keeps native stacks, causes, fields,
severity and the console/Datadog path. Development retains source-frame inspection.
Do not silence repeated errors, change the global Error prototype, increase API
deadlines or remove source maps from tracing/profiling.

## Prevention and limits

Test the actual Yoga execution/masking chain, not just a string helper. Verify
that a custom inspector is never invoked in production, every error is retained,
public domain errors stay public, and GraphQL source/variables are not included
through non-enumerable metadata. Use a fresh-process actual Next build for the
performance comparison: ordinary unit environments lack its patched inspector.

Keep failed controls. The initial client observation timed out after 30 seconds;
another control hit HTTP 408 followed by a response reset. Neither is a healthy
request or an OOM finding. The fixed build must be restored after local controls.

This fixes error amplification, not the underlying catalog allocation failure or
every historical capability-budget delay. The
[profiler source-map initialization correction](datadog-first-collection-lazy-source-maps-20260918.md)
affects a different consumer and does not address per-error Next inspection.
Preserve separate production HTTP, semantic fallback and browser populations when
verifying release recovery.
