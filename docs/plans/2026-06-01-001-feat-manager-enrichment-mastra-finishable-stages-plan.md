---
title: Manager Enrichment Mastra Finishable Stages
type: feat
status: completed
date: 2026-06-01
parent_plan: docs/plans/2026-05-28-001-feat-manager-enrichment-mastra-migration-plan.md
---

# Manager Enrichment Mastra Finishable Stages

## Goal

Finish the Mastra migration stages that can be safely completed inside this branch without needing production credentials, a long-running parity corpus, or the full legacy enrichment graph port.

This plan continues `docs/plans/2026-05-28-001-feat-manager-enrichment-mastra-migration-plan.md`. It is intentionally narrower than the parent plan: this branch should harden the Manager-to-Mastra runtime seam, prove the Mastra orchestration primitives needed by the next graph-port stage, and leave the remaining production rollout work clearly bounded.

## Current Stage

We are still in Phase 1 of the parent plan: dual-engine, flag-gated Mastra runtime work.

Already completed or currently present in the worktree:

- Manager can stamp Mastra-launched jobs with engine/run metadata.
- Manager starts Mastra through a two-phase accept/start flow so callback fencing metadata exists before Mastra can emit callbacks.
- Manager callback handling applies pre-auth rate limiting, runId fencing, sequence monotonicity, and terminal-state monotonicity.
- Manager has a first-callback watchdog for Mastra runs that start but never callback.
- Mastra exposes the enrichment workflow and internal start route needed by Manager.

Not yet in scope for this branch:

- Full production port of `videoEnrichment` into a Mastra-native graph.
- Transcript-only and scene-analysis pipeline production ports.
- Large corpus parity measurement and production ramp.
- Phase 2 removal of the legacy Manager workflow dependency.

## Requirements

1. Preserve the two-phase Mastra dispatch flow.
   - `apps/manager/src/services/mastra-enrichment.ts` must accept, persist run metadata, then start.
   - `apps/mastra/src/mastra/index.ts` must keep accept and start routes separate.
   - Tests must cover start failures after accept and ensure Manager-visible metadata is still stamped.

2. Preserve callback safety.
   - `apps/manager/src/app/api/internal/enrichment-callback/route.ts` must rate-limit before auth.
   - Callback application in `apps/manager/src/lib/state.ts` must ignore stale runIds, duplicate/out-of-order sequences, and contradictory callbacks after terminal states.
   - Tests must cover duplicate, stale, terminal, and rate-limited callback cases.

3. Preserve the first-callback watchdog.
   - `apps/manager/src/workflows/mastraEnrichmentWatchdog.ts` must fail only the same pending/running Mastra run when no callback has been recorded.
   - The watchdog must be scheduled only after Mastra start succeeds.
   - Tests must cover wrong runId, non-Mastra engine stamps, terminal jobs, and already-callbacked jobs.

4. Prove the Mastra orchestration primitives needed by the next stage.
   - Add a test-only Mastra primitive spike for `.parallel` output keying and `.foreach` concurrency.
   - Keep it independent from real enrichment services and network calls.
   - Use it as evidence for the next production graph-port stage.

5. Validate only the touched runtime surfaces.
   - Manager: targeted tests, typecheck, lint.
   - Mastra: targeted tests, typecheck, lint.
   - Repository: `git diff --check`.

## Implementation Units

### Unit 1: Runtime Seam Hardening

Files:

- `apps/manager/src/services/mastra-enrichment.ts`
- `apps/manager/src/workflows/launchVideoEnrichment.ts`
- `apps/mastra/src/mastra/index.ts`
- `apps/mastra/src/mastra/workflows/forge-video-enrichment.ts`

Acceptance:

- Manager records `currentRunId` and `dispatchedAt` before the Mastra workflow can begin.
- A failed Mastra start marks the job failed with a useful error.
- Callback-bearing Mastra workflow code only talks to Manager through the internal callback contract.

### Unit 2: Callback and Watchdog Safety

Files:

- `apps/manager/src/app/api/internal/enrichment-callback/route.ts`
- `apps/manager/src/lib/state.ts`
- `apps/manager/src/workflows/mastraEnrichmentWatchdog.ts`

Acceptance:

- Invalid callback traffic is rejected or ignored before mutating job state.
- Terminal states remain terminal.
- The watchdog catches no-callback starts without failing stale or already-progressed jobs.

### Unit 3: Mastra Primitive Spike

Files:

- `apps/mastra/src/mastra/workflows/forge-video-enrichment-primitives.test.ts`

Acceptance:

- `.parallel` branch output shape is documented by a passing test.
- `.foreach` concurrency behavior is documented by a passing test.
- The spike has no external service dependencies.

### Unit 4: LFG Completion Loop

Acceptance:

- Run Compound review against this plan and safely fix findings.
- Run browser/pipeline smoke evaluation for touched surfaces. If no browser surface exists, record that explicitly and keep validation CLI-focused.
- Commit and push the finished branch.
- Open or update the PR with the plan, validation, and remaining-stage boundary.

## Remaining Work After This Branch

The next branch should port the actual enrichment graph into Mastra after this seam is stable. That work should cover transcript-only, scene analysis, chapter generation, artifact writing, and parity measurement against the legacy Manager workflow before rollout.
