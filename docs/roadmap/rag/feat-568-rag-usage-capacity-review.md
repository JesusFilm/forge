---
id: "feat-568"
title: "Review RAG usage capacity before volume expansion"
owner: "jaco"
priority: "P2"
status: "not-started"
start_date: "2026-10-01"
duration: 2
depends_on: ["feat-528"]
blocks: []
tags: ["rag", "observability", "infrastructure"]
---

## Problem

Durable minute aggregates and pending accounting need measured capacity evidence before volume expansion. Durability is not an unlimited
storage promise.

## Entry Points — Read These First

1. `apps/rag/docs/ops/consumer-usage.md` — activation and accounting contract.
2. `apps/rag/src/adapters/postgres/consumer-usage.ts` — transactions and report scans.
3. `apps/rag/src/serving/http/usage.ts` — queued request/completion writes.
4. `apps/rag/prisma/migrations/20260929000000_consumer_usage/migration.sql`.

## Grep These

`usage_private`, `pending`, `UsageCollector`.

## What To Build

Measure synthetic peak admission/completion throughput, report latency, row/index
and backup growth, pending backlog after interruptions and accounting-write failures. Record measured safe volume
and monitoring thresholds. Propose retention changes separately if needed.

## Constraints

No production writes or secret/corpus evidence. Do not introduce implicit heavy-use
enforcement, sampled accounting or deletion policy within this review.

## Verification

Record synthetic workload, database/replica shape, revision, throughput,
latency and storage measurements. Verify stored counts remain readable across interruptions without deployment
inventory or coverage-state requirements.
