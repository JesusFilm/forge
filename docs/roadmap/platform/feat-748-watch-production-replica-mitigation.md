---
id: "feat-748"
title: "Restore Watch page headroom with two production Web replicas"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: ["feat-746"]
blocks: []
tags: [web, watch, performance, infrastructure]
---

## Problem

The single production Web request thread is nearly CPU-bound, producing
multi-second cached-page first-byte times. The user authorized increasing the
existing region to two replicas after reviewing the investigation.

## Entry Points — Read These First

1. `docs/reports/2026-10-20-watch-production-latency.md` — evidence and live results.
2. `docs/plans/2026-10-20-watch-replica-mitigation.md` — scope and reversal.
3. `apps/web/railway.toml` — existing production deployment configuration.

## Grep These

- `environments.production.deploy.multiRegionConfig`
- `numReplicas`
- `forge:web:next-cache:`

## What To Build

Apply the authorized live region replica increase and codify two replicas for
production `us-west2`. Preserve other environments' settings and shared-cache
invalidation. Retain feat-747 for the independent serialization repair.

## Constraints

No direct code deploy, restart, cache flush, feature-flag or frontend behavior
change. Do not claim sustained monitor recovery from short public probes.

## Verification

Require Railway `2/2 Online`, no crashed replicas or pending changes, and the
same active deployment. Repeat bounded public probes and summarize successful
page GET durations from origin logs. Validate TOML against Railway's JSON schema,
run formatting checks, and open a PR for the persistent setting and evidence.

October 20 result: Railway reports `2/2 Online` on the unchanged live release.
Eight public GETs returned HTTP 200 with 0.21–0.53 second first-byte times; the
bounded origin sample had 897 ms successful-page-GET p95. TOML passes Railway's
current JSON schema. Full observations and limitations are in the report.
