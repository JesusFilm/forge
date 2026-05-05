# Agentic Subtitle Enrichment Backend Brainstorm

Date: 2026-05-05

## What We're Building

Move the subtitle enrichment workflow execution out of Manager and into Agentic, backed by Mastra workflows. Manager remains the product-facing consumer: it keeps the coverage UI, automation UI, job list/detail views, approvals, and CMS-backed job truth, but it no longer runs the long-lived subtitle workflow in-process.

The first slice is subtitle-only:

1. Source subtitle creation/transcription when a video is missing source captions.
2. Target subtitle translation for one requested target language.
3. Subtitle artifact publication and Mux subtitle sync through constrained service contracts.
4. Step progress, artifact references, routing metadata, and failures reported back to Manager's existing enrichment job model.

This does not move the full video enrichment pipeline yet. Chapters, metadata, embeddings, audio cleanup, scene analysis, voiceover, and broader content generation stay on their current Manager paths until the subtitle backend proves the Agentic workflow boundary.

## Why This Approach

The existing Manager pipeline already has the right operator experience and job truth, but the workflow execution is app-local. That makes Agentic less reusable and keeps future apps from consuming the same agent/workflow platform without either duplicating orchestration or importing Manager internals.

Agentic is the better home for runtime concerns:

1. Mastra workflow run state, retries, traces, and Studio inspection.
2. Agent and tool registration that can be shared by future Forge apps.
3. Long-running orchestration separate from Manager's request lifecycle.
4. A single service boundary for future agentic workflows.

Manager is still the better home for business truth:

1. Coverage report selection and operator intent.
2. Automation definitions and automation run records.
3. Enrichment job records in CMS.
4. Approval, dry-run, and live-mode boundaries.
5. Artifact review, override, and recovery UX.

The clean split is: Manager decides what work should happen and shows what happened; Agentic executes the subtitle workflow and reports back through typed contracts.

## Current System Shape

Manager has three entry points into subtitle enrichment:

1. Coverage report selections call `POST /api/enrich` with selected `videoIds` and `targetLanguageIds`.
2. Existing-video enrichment uses `createEnrichmentJobs(...)`, creates an `EnrichmentJob`, then dispatches `launchVideoEnrichment(...)`.
3. Automation live mode selects eligible videos and calls the same `createEnrichmentJobs(...)` path.

The current in-process workflow lives in `apps/manager/src/workflows/videoEnrichment.ts`. It runs transcription first, then translation, chapters, metadata, embeddings, Mux upload, and optional cleanup or scene analysis. Subtitle translation reads `transcript.json`, writes `subtitles-{lang}.vtt` and `translation-{lang}.json`, then Mux sync publishes the subtitle track.

User-visible job truth lives in the CMS `EnrichmentJob` content type and is mirrored by Manager types in `apps/manager/src/types/job.ts`, `apps/manager/src/lib/workflow-steps.ts`, and `apps/manager/src/lib/state.ts`.

Agentic currently has only the Manager automation dry-run contract. That is useful precedent for service auth and typed Manager callbacks, but it is not yet a live subtitle workflow backend.

## Related Compound Docs Checked

1. `docs/brainstorms/2026-05-01-agentic-runtime-app-requirements.md` - Agentic app boundary and Manager-first consumer model.
2. `docs/roadmap/platform/feat-115-agentic-runtime-app.md` - Agentic runtime ownership and cross-app constraints.
3. `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md` - current enrichment pipeline owner and entry points.
4. `docs/roadmap/media-generation/feat-084-manager-agents-automations.md` - automation templates and capped scheduled execution.
5. `docs/plans/2026-03-28-002-feat-subtitle-translation-pipeline-plan.md` - original subtitle translation workflow shape.
6. `docs/solutions/integration-issues/manager-automation-dry-run-report-boundary-20260413.md` - dry-run must stay above live job creation and suppress downstream mutations.
7. `docs/solutions/integration-issues/manager-agents-target-subtitle-contract-and-language-labels-20260412.md` - one target subtitle automation means one target language in V1.
8. `docs/solutions/integration-issues/manager-transcription-routing-artifact-boundary-20260412.md` - canonical subtitle artifacts stay stable while provider routing stays metadata.
9. `docs/solutions/integration-issues/manager-elevenlabs-routing-and-rerun-2026-04-11.md` - failed attempts must not overwrite the last canonical subtitle artifacts.
10. `docs/solutions/platform/adding-new-apps.md` and `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` - app boundary, CI, and Railway config lessons.

## Recommended Product Shape

Manager should expose a small "start subtitle enrichment" consumer contract to Agentic instead of embedding Mastra. From the user's point of view, the existing Manager controls keep working:

1. Operators select videos and target language from Coverage.
2. Manager creates or reuses a CMS `EnrichmentJob`.
3. Manager sends a service request to Agentic with a job id, video identity, source language, target language, artifact context, and idempotency key.
4. Agentic starts a Mastra workflow run and stores the Agentic run id.
5. Agentic reports step status and artifact metadata back to Manager.
6. Manager renders the existing job list and job detail views from CMS state.

For automations, Manager still selects eligible videos and enforces caps. Agentic should execute only the work Manager asks it to execute. That preserves the current dry-run and approval boundaries while making the runtime reusable.

## Key Decisions

### 1. Subtitle workflow first, not full enrichment migration

The migration should start with source subtitles and target subtitles only. The current `runVideoEnrichment` workflow combines many concerns, but subtitles are the clearest platform slice because they already have direct coverage report and automation templates.

### 2. Manager remains consumer and business authority

Manager should not run the workflow implementation, but it should still own the CMS-backed job record, operator UX, automations, approvals, and coverage decisions. "Pure consumer" means Manager consumes Agentic workflow APIs instead of importing or hosting Mastra workflow code.

### 3. Agentic owns execution state and orchestration

Agentic owns the Mastra workflow definition, run ids, runtime storage, retries, traces, Studio visibility, tool registry, and step execution. Future apps should be able to call the same Agentic workflow boundary without importing Manager internals.

### 4. Cross-app communication stays HTTP-only

Do not cross-import Manager workflow code into Agentic or Agentic workflow code into Manager. If shared types become necessary, introduce a deliberately scoped package or generated contract after planning proves it is worth the maintenance cost.

### 5. Preserve existing artifact contracts

Keep canonical artifact names and formats stable:

1. `transcript.json`
2. `subtitles-{lang}.vtt`
3. `translation-{lang}.json`
4. transcription routing metadata
5. Mux sync report metadata

Provider-specific attempts can change, but successful canonical outputs must remain predictable for existing Manager review, rerun, and recovery flows.

### 6. Keep one target language in V1

Target subtitle automation should remain one target language per run. The repo's existing target subtitle contract intentionally avoids multi-target ambiguity until coverage eligibility can represent per-language ownership clearly.

### 7. Dry-run and live mode remain separate

Dry-run should continue to produce reports without creating live jobs or mutating artifacts. Live mode should require an explicit Manager-created job plus an idempotency key. Agentic should reject live requests that do not reference a Manager-approved job.

### 8. Side effects stay constrained

Agentic may execute transcription, translation, and Mux sync steps, but live mutations should be behind narrow Manager/CMS/Mux service contracts with typed failures. Agentic should not gain broad CMS mutation power just because it can run a workflow.

## Candidate Contracts

### Manager to Agentic

`POST /forge/subtitle-enrichment-runs`

Payload:

1. `jobId`
2. `videoId`
3. `muxAssetId`
4. `muxPlaybackId`
5. `sourceLanguage`
6. `targetLanguage`
7. `mode: "dry_run" | "live"`
8. `idempotencyKey`
9. `artifactContext`
10. `requestedBy`

Response:

1. `ok`
2. `agenticRunId`
3. `status`
4. `managerJobId`
5. typed failure code when rejected

### Agentic to Manager

`POST /api/agentic/subtitle-enrichment-runs/:runId/events`

Event types:

1. `workflow_started`
2. `step_started`
3. `step_completed`
4. `step_failed`
5. `artifact_created`
6. `workflow_completed`
7. `workflow_failed`

Manager should translate these events into the existing `EnrichmentJob` status, step status, artifacts, and errors.

## Candidate Implementation Phases

### Phase 1: Contract and no-op workflow

Add the Agentic subtitle workflow API, schemas, auth, idempotency, and a no-op Mastra workflow that reports start and completion back to Manager. Manager still has a feature flag that keeps the current local workflow path as fallback.

### Phase 2: Move subtitle execution

Move or re-home the source transcription and target subtitle translation execution behind Agentic tools. Keep artifact outputs identical. Manager starts Agentic runs instead of `launchVideoEnrichment(...)` for subtitle-only jobs.

### Phase 3: Move subtitle publication

Let the Agentic workflow perform the Mux subtitle sync through a narrow Manager-approved service contract. Keep override and recovery UX in Manager.

### Phase 4: Retire Manager-local subtitle orchestration

Once Agentic status, artifacts, retries, and failure semantics match Manager behavior, remove the Manager-local subtitle workflow path for the migrated cases. Leave non-subtitle enrichment steps untouched.

## Non-Goals

1. Do not migrate chapters, metadata, embeddings, scene analysis, audio cleanup, or voiceover in this slice.
2. Do not make Agentic the canonical content store.
3. Do not let Agentic select automation candidates.
4. Do not broaden free-form agent instructions for live media mutations.
5. Do not replace Manager's job and coverage UI.
6. Do not depend on Mastra Studio as the user-facing status surface.

## Risks

1. Duplicate job truth if Agentic stores business state instead of runtime state.
2. Lost operator context if Manager stops receiving granular step and artifact events.
3. Unsafe retries if idempotency is weak across Manager and Agentic boundaries.
4. Artifact drift if Agentic changes canonical file names or metadata formats.
5. Over-broad service auth if Agentic receives general CMS mutation credentials.
6. Confusing rollback if Manager cannot fall back to the local workflow during rollout.

## Validation Ideas

1. Contract tests for Manager-to-Agentic run creation and Agentic-to-Manager events.
2. Red/green test showing Manager starts Agentic for subtitle-only jobs behind the feature flag.
3. Red/green test showing dry-run does not create jobs or artifacts.
4. Idempotency test showing duplicate Manager requests return the same Agentic run.
5. Artifact compatibility test comparing generated `subtitles-{lang}.vtt` and `translation-{lang}.json` shape to the current Manager contract.
6. User smoke test from Coverage: select one video and one target language, start enrichment, then watch the Manager job detail page update from Agentic events.
7. Operator smoke test for Mastra Studio: confirm the Agentic run appears with step trace and cannot be accessed without operator auth.

## Open Questions

None for the brainstorm handoff. The working assumptions are:

1. "Manager is purely consumer" means Manager does not host the Mastra workflow, while it still owns operator UX and CMS-backed job truth.
2. The first implementation slice is subtitle-only.
3. One target language per subtitle run remains the V1 safety boundary.
