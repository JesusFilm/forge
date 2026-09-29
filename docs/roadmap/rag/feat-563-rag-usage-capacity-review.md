---
id: "feat-563"
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

Durable minute aggregates and pending accounting need measured capacity and fleet
inventory evidence before volume expansion. Durability is not an unlimited
storage promise.

## Entry Points — Read These First

1. `apps/rag/docs/ops/consumer-usage.md` — activation and accounting contract.
2. `apps/rag/src/adapters/postgres/consumer-usage.ts` — transactions and report scans.
3. `apps/rag/src/serving/http/usage.ts` — serial writes and heartbeat cadence.
4. `apps/rag/prisma/migrations/20260929000000_consumer_usage/migration.sql`.

## Grep These

`usage_private`, `complete_through`, `pending`, `UsageCollector`.

## What To Build

Measure synthetic peak admission/completion throughput, report latency, row/index
and backup growth, pending backlog, five-second heartbeat overhead and outage
recovery. Verify deployment/replica inventory independently of self-registration;
measure correctness and operator cost of the independent deployment inventory
through rolling deployments and replica changes. Record measured safe volume
and monitoring thresholds. Propose retention changes separately if needed.

## Constraints

No production writes or secret/corpus evidence. Do not introduce implicit heavy-use
enforcement, sampled accounting or deletion policy within this review.

## Verification

Record synthetic workload, database/replica shape, revision, throughput,
latency and storage measurements. Demonstrate missing-instrumentation detection
or explicitly bound the operational inventory requirement before expansion.
