---
id: "feat-625"
title: "Close RAG health diagnostics and support gaps"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-10-08"
duration: 5
depends_on: []
blocks: []
tags: ["rag", "strategy", "documentation"]
---

## Problem

Feat-605 shipped safe instrumentation, but did not establish the cause or
resolution of intermittent failures. Operators need a bounded support path.

## Entry Points — Read These First

1. `docs/roadmap/rag/feat-605-rag-safe-search-diagnostics.md` — existing evidence limits.
2. `apps/rag/docs/ops/http-service.md` and `consumer-usage.md` — health and accounting.
3. `docs/solutions/architecture-patterns/rag-usage-recorded-counts-and-transport-completion.md`.
4. `docs/roadmap/rag/feat-568-rag-usage-capacity-review.md` — capacity measurements.

## Grep These

`requestId`, `/v1/health`, `UsageCollector`, `timeout`.

## What To Build

Define a support intake using request ID, timestamp, consumer identifier, endpoint,
status and safe error class. Distinguish process health, authenticated retrieval,
database/provider failure, authorization denial, empty valid results and stale
source snapshots. Correlate safe instrumentation to reproduce intermittent
failures or record remaining uncertainty; open bounded fixes only from evidence.

Specify bounded synthetic health checks, alert routing, owner and escalation
criteria, with rate/cost limits and stale-check detection. Agree alert thresholds
before activation. Keep checks separate from usage accounting: reports remain
recorded counts and zero rows do not imply an outage or missing-coverage gate.

## Constraints

Preserve the separate RAG service/database and consumer-neutral retrieval contract.
This roadmap authorizes no source import, production mutation, credential handling,
deployment or purchase. Future execution needs its own bounded scope and authority.
Dates and durations are planning placeholders, not delivery commitments.

## Verification

A local failure drill covers unhealthy dependency, rejected credentials, timeout,
empty successful retrieval and accounting-write failure. Each maps to a support
owner/action without secrets or corpus text. Demonstrate health 200 alone cannot
pass authenticated retrieval verification. Close the intermittent-failure item
only with reproduced cause/fix evidence or an explicitly accepted unresolved
limitation; instrumentation deployment alone is insufficient.
