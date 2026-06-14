---
id: "feat-188"
title: "Manager job state and Mastra correlation hardening"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-13"
duration: 1
depends_on:
  - "feat-184"
  - "feat-186"
blocks: []
tags:
  - "manager"
  - "mastra"
  - "job-state"
  - "subtitle-enrichment"
---

## Problem

Admin-backed Manager enrichment jobs can lose terminal state updates when
workflow callers intentionally clear nullable fields with `undefined`.
Mastra-owned substeps also return run IDs, but Manager does not consistently
persist those IDs with job-step evidence for operator diagnosis.

## Entry Points - Read These First

1. `docs/plans/2026-06-13-002-fix-manager-job-state-mastra-correlation-plan.md`
   - implementation plan and acceptance examples.
2. `apps/manager/src/lib/state.ts`
   - Manager job state facade and Admin update boundary.
3. `apps/manager/src/workflows/jobStateSteps.ts`
   - workflow-facing state write wrappers.
4. `apps/manager/src/workflows/videoEnrichment.ts`
   - enrichment workflow and Mastra sub-workflow launch points.
5. `apps/manager/src/services/mastra-subtitle-enrichment.ts`
   - Mastra subtitle workflow result envelope.
6. `apps/manager/src/services/mastra-transcript-embeddings.ts`
   - Mastra transcript embedding workflow result envelope.

## Grep These

- `buildJobUpdateData`
- `currentStep: undefined`
- `stepUpdateStepStatus`
- `mastraRunId`
- `languageResults`

## What To Build

- Normalize admin-mode Manager job updates through `buildJobUpdateData(...)`
  before calling Admin GraphQL so explicit clears become `null`.
- Make workflow-critical writes throw when persistence fails or returns `null`.
- Persist allowlisted Mastra correlation details on translation and embeddings
  steps when Mastra returns a run ID.
- Preserve failed step status, step errors, terminal job failure state, and
  previously written artifacts when later steps fail.

## Constraints

- Manager/Admin remains the canonical job-state system.
- Do not move the full enrichment workflow into Mastra.
- Do not persist prompts, transcripts, raw request bodies, service tokens, or
  other sensitive payloads in job details.
- Do not hand-edit generated GraphQL artifacts.

## Verification

- `pnpm --filter @forge/manager test -- state.test.ts`
- `pnpm --filter @forge/manager test -- jobStateSteps.test.ts`
- `pnpm --filter @forge/manager test -- videoEnrichment.test.ts`
- `pnpm --filter @forge/manager typecheck`
