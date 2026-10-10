---
title: Unbounded cache cleanup blocks shared Redis admission
date: 2026-09-16
category: performance-issues
module: Watch Redis cache and recommendation admission
problem_type: performance_issue
component: service_object
symptoms:
  - "Cache cleanup runs HDEL commands with more than 430,000 fields"
  - "Independent Redis requests exceed the 250 ms admission budget during cleanup"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [web, redis, recommendations, cache, latency, batching]
---

# Unbounded cache cleanup blocks shared Redis admission

## Problem

Web's ISR cache and recommendation admission use the same Redis server. Moving
admission I/O onto a native Node worker protects it from page-processing CPU,
but cannot protect it from a command that blocks Redis itself.

Read-only production SLOWLOG inspection on 15 September showed cache HDELs with
430,486 fields taking 210–254 ms, and earlier HDELs with 542,713 fields taking
368 ms. The keys were the cache handler's shared tag and expiration hashes.
Admission retains a 250 ms command budget for ordinary profile requests.

## Investigation and limits

The pinned `@fortedigital/nextjs-cache-handler@3.2.1` Redis string handler scans
metadata using HSCAN COUNT 10,000. Both tag invalidation and expired-entry
cleanup then accumulate every matching entry and send one UNLINK and two HDEL
commands containing the entire result. Paged scanning does not bound deletion.

The production slow-log argument array is itself truncated. The final argument
can contain a count of omitted arguments; counting only the returned array
would incorrectly report 32 arguments instead of hundreds of thousands.
Inspect counts and recognized cache-key roles without logging raw arguments.

Redis command histograms showed TIME itself taking less than 8.5 ms and EVAL
less than 17 ms over their recorded lifetimes. Such command execution timings
exclude time waiting behind another command. Fast TIME execution therefore
does not establish a fast end-to-end admission request.

The slow cleanup timestamps did **not** match the latest 02:55 and 05:51
admission failures. This patch fixes a confirmed contention mechanism; it is
not evidence that those particular incidents or the separate selection
timeouts are resolved. The Redis latency monitor was disabled, so an empty
LATENCY LATEST response did not establish absence of server stalls.

## Solution

The repository's pnpm patch changes both ESM and CommonJS Redis string handlers:

- Divide invalidation and expiration deletions into batches of at most 500.
- For each batch, unlink the values and remove the same fields from both
  metadata hashes. Await the batch before submitting the next.
- Reuse one existing five-second deletion deadline across the batches.
  Propagate failures and stop starting batches after timeout.
- Preserve scan behavior, cache serialization, key prefixes, expiration rules,
  normal reads/writes and recommendation admission limits.

The patch is registered in root `package.json` and `pnpm-lock.yaml` at
`patches/@fortedigital__nextjs-cache-handler@3.2.1.patch`. Reassess it when
upgrading the package; do not silently remove the bounded-command invariant.

## Verification

An isolated local Redis reproduction populated both metadata hashes with
550,000 expired entries. A separate Node worker sampled TIME every 10 ms so
main-thread array construction could not masquerade as Redis latency.

| Measurement                      | Original | Batches of 500 |
| -------------------------------- | -------: | -------------: |
| Cleanup duration                 | 3,750 ms |       3,993 ms |
| Maximum independent TIME latency |   435 ms |        9.78 ms |
| Samples exceeding 250 ms         |        2 |              0 |
| Metadata entries remaining       |        0 |              0 |

Cleanup traded 243 ms of total background/startup duration for sharply reduced
interference with other clients. This experiment isolates shared-Redis
contention; it does not claim every page becomes faster.

All eight regression tests failed against the original package and passed
against the patch. They exercise both module exports, expired and tagged
entries, final partial batches, live-entry preservation, failure propagation,
and deadline cancellation. Two real-Redis cache tests additionally verify
readable live values and removal of a tagged cached value. The existing eight
admission integration tests continue to pass.

Test entry points:

- `apps/web/scripts/redis-cache-cleanup.test.mjs`
- `apps/web/scripts/redis-cache-cleanup.redis-cases.mjs`
- `apps/web/src/lib/recommendation-mutation-admission.redis.db.test.ts` imports
  the cache cases so the existing CI Redis entrypoint exercises both paths.

## Prevention

Bound command size as well as scan size whenever bulk maintenance shares a
database with requests that have short deadlines. Measure from a separate
client/process and inspect server timings before attributing all timeouts to
application event-loop CPU. Keep complete-output assertions alongside latency
measurements so dropping work cannot look like an optimization.

Related: [native admission worker](page-rendering-blocks-redis-admission-callbacks-20260915.md),
[Redis clock refresh](redis-clock-sample-can-expire-admission-early-20260915.md),
and [recovery tracking](../../roadmap/platform/feat-496-watch-rollout-runtime-recovery.md).
