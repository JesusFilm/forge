---
id: "feat-714"
title: "Keep disabled support research independent of database migration"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-16"
duration: 1
depends_on: []
blocks: []
tags: [mastra, support-research, reliability]
---

## Problem

The scheduled `daily-support-research` workflow reads
`support_research.cursors` and claims a durable run before evaluating its
default-off feature and provider gates. Environments that correctly leave the
feature disabled but have not applied migration `002-support-research.sql`
therefore fail every day instead of returning the promised typed disabled
report.

## Entry Points — Read These First

1. `apps/mastra/src/mastra/workflows/daily-support-research.ts` — workflow orchestration and readiness gates.
2. `apps/mastra/src/mastra/workflows/daily-support-research.test.ts` — dependency-injected workflow coverage.
3. `docs/runbooks/support-research-agent.md` — migration, enablement, and privacy boundary.
4. `apps/mastra/migrations/002-support-research.sql` — additive schema required before enablement.

## Grep These

- `executeDailySupportResearch|getSupportResearchReadiness`
- `getCursor|claimRun|feature_disabled|invalid_input`

## What To Build

Evaluate invalid input and the default-off feature gate before any repository
operation. Return a typed, counts-only disabled report using the bounded
fallback cursor, without opening a run, retention sweep, Help Scout read, model
call, or Linear action. Preserve the existing durable disabled report behavior
for an enabled feature that fails later configuration readiness checks.

## Constraints

Do not apply production migrations, enable support research, or weaken provider
approval, privacy, URL, retention, Help Scout, or Linear readiness checks. The
enabled workflow must continue to require migration `002` and durable storage.

## Verification

Assert a disabled workflow makes no repository, Help Scout, model, or Linear
calls; invalid input also exits before storage; enabled-but-unready execution
still records its durable disabled report. Run focused tests, Mastra typecheck,
lint, formatting, and roadmap validation.
