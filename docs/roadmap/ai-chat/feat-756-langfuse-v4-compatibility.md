---
id: "feat-756"
title: "Verify Langfuse v4 ingestion and lifecycle compatibility"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-10-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-chat"
  - "observability"
---

## Resolution

**Prepared:** October 23, 2026 in [PR #2863](https://github.com/JesusFilm/forge/pull/2863)
(`fix(mastra): verify Langfuse v4 observation compatibility`). Unmerged and
undeployed; this status covers the code/audit scope, not operational rollout.

The existing SDK already meets the v4 minimum. This change makes ingestion
selection explicit, exposes Seeker-turn provenance as filterable observation
metadata, and adds eight real-export regression cases. Independent review found
no blocking defects; its documentation correction and additional test cases were
incorporated. The full Mastra suite passed 3,879 tests before the six additional
wire cases; all eight final wire cases, typecheck, lint and formatting pass.

Durable evidence and the required operator checks are in
`docs/reports/2026-10-23-langfuse-v4-readiness.md`. Account-side migration and
synthetic live verification require a separately authorized rollout.

## Problem

Langfuse Cloud retires legacy v3 features on November 16, 2026. Audit Forge's
actual exporter and read/delete APIs against the observations-first contract.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/langfuse-tracing.ts` — opt-in routing and exporter.
2. `apps/mastra/src/mastra/langfuse-trace-retention.ts` — retention and erasure APIs.
3. `apps/mastra/src/services/langfuse-prompt-client.ts` — pinned prompt retrieval.
4. `apps/chat/src/features/apologist/server/prompt.ts` — additional prompt reader.
5. `pnpm-lock.yaml` — actual transitive Langfuse SDK versions.

## Grep These

`langfuse`, `/api/public/`, `LangfuseExporter`, `LANGFUSE_TRACING_ENABLED`.

## What To Build

Verify installed SDK transport against a loopback HTTP collector, preserving
session/user attribution, prompt linkage, child observations, usage, error
fields, and the routing marker boundary. Make only required compatibility
changes. Record source evidence, test results and operator verification in
`docs/reports/2026-10-23-langfuse-v4-readiness.md`.

## Constraints

No deployments, merges, live provider calls, prompt changes, or production
credentials. Preserve default-off tracing, no raw local storage, and existing
retention/erasure safeguards. Cloud project settings require owner verification.

## Verification

Run the real-exporter loopback test, related tracing/prompt/retention/erasure
regressions, Mastra lint/typecheck, and changed-file formatting. Independent
subagent review must precede final handoff.
