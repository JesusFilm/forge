---
id: "feat-116"
title: "Mastra Subtitle Enrichment Backend"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-05-05"
duration: 7
depends_on:
  - "feat-031"
  - "feat-084"
  - "feat-129"
blocks: []
tags:
  - "manager"
  - "mastra"
  - "ai-pipeline"
---

## Problem

Manager currently owns both the operator experience and the long-lived subtitle enrichment workflow execution. That keeps Mastra from acting as the shared backend platform for agents and workflows, and it makes future Forge apps consume Manager internals if they need similar workflow capabilities.

Recreate the existing Manager subtitle enrichment workflow as a Mastra backend workflow so Manager becomes a consumer of Mastra workflow APIs while retaining the product-facing job, coverage, automation, and approval surfaces.

## Entry Points -- Read These First

1. `docs/brainstorms/2026-05-05-agentic-subtitle-enrichment-backend-brainstorm.md` -- chosen boundary and phased migration shape
2. `docs/roadmap/platform/feat-129-mastra-railway-workflow-runtime.md` -- current Mastra app boundary and runtime service model
3. `apps/manager/src/workflows/videoEnrichment.ts` -- current Manager enrichment workflow orchestration
4. `apps/manager/src/workflows/launchVideoEnrichment.ts` -- current workflow dispatch wrapper
5. `apps/manager/src/app/api/enrich/route.ts` -- current enrichment job creation API
6. `apps/manager/src/features/agents/automation-runner.ts` -- automation candidate selection, dry-run, and live enqueue boundary
7. `apps/manager/src/services/subtitleTranslation/` -- current subtitle translation service and result contracts
8. `apps/manager/src/services/mux-sync/` -- current subtitle publication and Mux sync behavior
9. `apps/mastra/src/mastra/workflows/` -- current Mastra service contract and route handler patterns
10. `apps/mastra/AGENTS.md` -- Mastra app ownership and auth boundaries

## Grep These

- `runVideoEnrichment|launchVideoEnrichment|createEnrichmentJobs` in `apps/manager/src/` -- current Manager-owned orchestration
- `translateSubtitles|TranslationResult|subtitles-` in `apps/manager/src/services/subtitleTranslation/` -- subtitle artifact contract
- `syncTranslatedSubtitlesToMux|MuxSyncReport` in `apps/manager/src/services/mux-sync/` -- subtitle publication contract
- `target_subtitles_missing|AutomationRunMode|dry_run` in `apps/manager/src/features/agents/` -- automation safety boundary
- `handleTranscriptEmbeddingRouteRequest|/forge-transcript-embeddings` in `apps/mastra/src/` -- existing Manager-to-Mastra contract precedent
- `EnrichmentJob|WorkflowStepName|JobArtifactManifest` in `apps/manager/src/` and `apps/cms/src/api/enrichment-job/` -- Manager/CMS job truth

## What To Build

1. Define typed Manager-to-Mastra and Mastra-to-Manager contracts for subtitle enrichment runs, events, idempotency, auth, typed failures, and artifact references.
2. Add a Mastra workflow for subtitle enrichment that owns runtime execution, step state, retries, traces, and Studio visibility.
3. Keep Manager as the consumer that creates CMS `EnrichmentJob` records, starts Mastra runs, receives events, and renders job status.
4. Migrate source subtitle transcription and one-target-language subtitle translation behind Mastra workflow execution while preserving existing artifact names and formats.
5. Publish subtitles to Mux through a constrained service contract that preserves Manager approval, override, and recovery semantics.
6. Keep dry-run above live job creation and ensure dry-run suppresses downstream artifact and Mux mutations.
7. Feature-flag the Mastra path so Manager can fall back to the local workflow during rollout.
8. Add Red/Green tests plus a user smoke test from Manager Coverage to job detail and Mastra Studio trace.

## Constraints

- Do not move all video enrichment steps in this slice; subtitles only.
- Do not make Mastra the canonical content store or canonical job truth.
- Do not let Mastra select automation candidates; Manager keeps eligibility, caps, schedules, and approvals.
- Do not support multiple target languages in one V1 subtitle run.
- Do not change canonical artifact file names or shapes without a compatibility plan.
- Do not cross-import Manager internals into Mastra or Mastra internals into Manager.
- Do not grant Mastra broad CMS mutation credentials.

## Verification

- Contract tests show duplicate Manager requests with the same idempotency key return the same Mastra run.
- Manager subtitle-only jobs start Mastra workflow runs behind a feature flag.
- Mastra events update the existing CMS `EnrichmentJob` status, step records, artifacts, and errors.
- Dry-run produces a report and does not create live jobs, artifacts, or Mux subtitle tracks.
- Generated subtitle artifacts remain compatible with the current `subtitles-{lang}.vtt` and `translation-{lang}.json` contracts.
- A user smoke test in Manager selects one video and one target language from Coverage, starts subtitle enrichment, and sees the job detail page update from Mastra events.
- An operator smoke test verifies the run appears in Mastra Studio and Studio remains bearer-auth protected.
