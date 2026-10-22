---
id: "feat-756"
title: "Verify Langfuse v4 ingestion and lifecycle compatibility"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-10-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "ai-chat"
  - "observability"
---

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
