---
id: "feat-746"
title: "Diagnose October 20 Watch production latency and monitor failures"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: ["feat-747", "feat-748"]
tags: [web, watch, performance, infrastructure]
---

## Problem

The Watch owner reported very poor Railway performance. Slack `#ds-emergency`
contains six Checkly failure/recovery pairs on October 20 NZDT. Independent
HTTP probes reproduced 12.8-second homepage TTFB and 31.4-second Jesus detail
TTFB. Diagnose the live request delay and distinguish confirmed mechanisms
from deployment correlation.

## Entry Points — Read These First

1. `apps/web/CLAUDE.md` — production topology and performance verification.
2. `apps/web/cache-handler.mjs` — shared Redis cache operations.
3. `apps/web/next.config.mjs` — cache and generated ETag settings.
4. `apps/web/src/observability/memory-diagnostics.ts` — existing diagnostics.
5. `docs/solutions/performance-issues/watch-etag-hashing-starves-recommendation-admission-20260915.md`.
6. `docs/solutions/performance-issues/shared-redis-cache-cleanup-blocks-admission-20260916.md`.

## Grep These

- `forgeWebCacheHandlerConfig`
- `generateEtags`
- `memory-diagnostics`
- `ETIMEDOUT`
- `FLAG_NOT_FOUND`

## What To Build

Collect read-only production Railway metrics, bounded runtime/HTTP logs, Slack
monitor details, and repeatable public HTTP timing. Compare the healthy prior
day, pre-deployment period, and alert windows. Retain redacted evidence in a
dated report under `docs/reports/`. Inspect dependency latency and live process
state where needed. Record a specific repair follow-up if diagnosis cannot
establish and validate a safe fix within this scope.

## Constraints

- Diagnostic scope; no production deployments, restarts, cache flushes, or
  infrastructure changes.
- Preserve GA, Datadog, recommendation behavior, and player semantics.
- Do not retain secrets, cookies, IP addresses, capabilities, raw cache values,
  or recommendation request payloads.
- Existing unrelated manager changes belong to another task.

## Verification

- Re-run bounded public HTTP probes with status, TTFB, total duration, and bytes.
- Match Slack alert timestamps to UTC Railway windows explicitly.
- Separate platform resource limits from single-process/runtime contention.
- Document confirmed findings, unresolved causes, and actionable next steps.
- Run Prettier on added Markdown.

## Outcome

Completed read-only investigation with independent HTTP reproduction, Slack
alert correlation, private dependency probes and brief CPU profiles. Findings,
limitations and the runnable latency signal are in
`docs/reports/2026-10-20-watch-production-latency.md`. `feat-747` tracks repair
and post-deploy verification; no live recovery is claimed.
