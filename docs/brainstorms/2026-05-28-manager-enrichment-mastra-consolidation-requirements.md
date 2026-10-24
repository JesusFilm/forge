---
date: 2026-05-28
topic: manager-enrichment-mastra-consolidation
---

# Migrate Manager Enrichment Workflows to Mastra (Engine Consolidation)

## Problem Frame

Manager runs its AI video-enrichment pipeline (transcription, subtitle translation, chapters, metadata, embeddings, mux sync, audio cleanup, scene analysis) as **procedural TypeScript on the `workflow` npm SDK** (`^4.2.2`), using `"use workflow"` / `"use step"` directives. Meanwhile `apps/mastra` is the strategic AI-orchestration app — 7 production workflows on `@mastra/core`, Studio UI, PG store, DuckDB traces — and **Manager already calls Mastra** for transcript embeddings.

The result is **two workflow engines** carrying the same orchestration concern. The goal is to retire the `workflow` SDK from Manager and make Mastra the single engine. This is fundamentally a **consolidation** effort, not a redesign: behavior is held constant while the engine underneath changes.

Maps to roadmap **feat-031 "AI Video Enrichment Pipeline"** (P0, in-progress).

## Requirements

- **R1. Single workflow engine.** Remove the `workflow` npm SDK (`^4.2.2`) from `apps/manager`. After this work, Mastra is the only workflow-orchestration engine in the repo and no `"use step"` / `"use workflow"` directives remain in Manager.

- **R2. Full graph migration in one cutover.** Port the entire enrichment graph to Mastra: every step of `videoEnrichment` (`transcribe → parallel{translate, chapters, metadata, embeddings} → mux upload → optional{audio cleanup, scene analysis}`), plus the sibling `transcriptOnlyPipeline`, the shared `jobStateSteps` helpers, and `sceneAnalysisPipeline`. All four move together so the dependency can actually be dropped (R1).

- **R3. Manager stays trigger + UI.** Manager keeps its public API surface and enrichment UI. Every existing trigger point now delegates to Mastra instead of `start(run…)`, with none left on the old engine:
  - `POST /api/enrich`
  - `POST /api/jobs`
  - `/api/jobs/[id]/transcription/rerun`
  - `/api/admin-trigger/transcript` (transcript-only)
  - `/api/admin-trigger/scene-analysis` (scene analysis)
  - the agent **automation runner**, which references the workflow by the string name `"runVideoEnrichment"` (registry pattern)

- **R4. Admin job records are the integration seam.** Mastra writes run progress — status, `currentStep`, per-step status, artifacts, errors, timestamps — to the **same Admin GraphQL job records** the pipeline writes today. The job-record schema/contract is held stable. Manager's job UI and translation progress map render **unchanged, with zero UI code edits**.

- **R5. Behavior parity (golden-output).** For identical inputs, the Mastra-run pipeline produces artifacts (`subtitles-{lang}.vtt`, `translation-{lang}.json`, `transcript.json`, chapters, metadata) and Admin job records equivalent to the old engine — same prompts, same models, same step ordering, same fatal vs non-fatal error isolation, same partial-language-failure handling, same idempotent re-run behavior.

- **R6. Sanctioned opportunistic fixes only.** The move may absorb small, **output-neutral** wins: step-level retry configuration, Mastra trace/observability hooks, dead-code removal, tighter error isolation. None may change a produced artifact or job-record value. Anything that would alter outputs is out of scope (see boundaries).

- **R7. Cutover safety.** Provide a way to validate and roll back the big-bang switch: run the Mastra engine against the old engine on the same inputs and diff outputs before flipping production, and retain an instant rollback path for at least one release window.

## Success Criteria

- `apps/manager/package.json` no longer lists `workflow`; a repo-wide grep for `"use step"` / `"use workflow"` in `apps/manager` returns nothing.
- Golden-output diff is clean across all step types for a representative corpus — at minimum: a structurally-diverse multi-language video, a transcript-only run, and a scene-analysis run.
- All trigger points in R3 exercised end-to-end produce correct Admin job records; Manager UI shows live progress with no UI changes.
- Mastra is the sole workflow engine; Studio shows enrichment runs with per-step traces.
- A documented rollback flips back to the old engine without data loss inside one release window.

## Scope Boundaries

- **No output changes:** no prompt edits, no model swaps, no language-config changes, no artifact-shape changes. Outputs must stay equivalent.
- **No transcription changes:** Mux-built-in → ElevenLabs fallback stays as-is.
- **No redesign:** not turning steps into agents, branching, suspend-resume-by-default, or config-driven prompts/languages (the "re-architect" path was explicitly declined).
- **No Admin job-schema changes:** it's the stable seam.
- **No new Manager UI:** progress map and job views stay exactly as they are.
- **Only the four pipelines + their services** move — no unrelated Manager features.

## Key Decisions

- **Consolidate onto Mastra (not vice-versa):** Mastra is already the strategic AI-orchestration app (Studio, traces, PG store, 7 workflows) and Manager already calls it. Embeddings (already a Mastra workflow) and scene-embedding become **internal composed steps**, removing a cross-app HTTP round-trip.
- **Single cutover over incremental:** user choice; accept the larger blast radius, mitigated by the engine flag + golden-parity harness (R7).
- **Migrate all SDK-bound code at once:** required to actually drop the `workflow` dependency — the whole point of the effort. `videoEnrichment`, `transcriptOnlyPipeline`, and `jobStateSteps` all carry `"use step"`; `sceneAnalysisPipeline` is plain async but comes along since it shares the same services.
- **Admin job records as the seam:** keeps the entire Manager UI working untouched and preserves a single source of job truth.
- **Parity-first:** isolates "the engine swap broke something" from "we changed behavior," keeping any regression attributable.

## Dependencies / Assumptions

- The existing bearer-auth Manager→Mastra `/forge-*` seam (already used for transcript embeddings) extends to the enrichment trigger.
- Mastra gains an Admin GraphQL job-write client (or calls a thin Manager status-callback endpoint) with job-mutation scope to satisfy R4.
- The work-doing services — `transcription`, `subtitleTranslation`, `chapters`, `metadata`, `mux` / `mux-sync`, `audioCleanup`, `sceneAnalysis`, `openrouter`, `storage` — can move into Mastra (or a shared package) without deep Manager-only coupling. **To be verified** in planning.
- Mastra's suspend/resume + PG store can replicate the `workflow` SDK's step-checkpoint / resume-on-crash / idempotent-re-run guarantees.
- Mastra's Railway service can run long multi-language jobs (50+ langs × 3 LLM calls × N chunks) within timeout/memory limits, **asynchronously** (no blocking HTTP).

## Technical Direction (high-level — this brainstorm is an architecture migration)

- Enrichment becomes a Mastra workflow (`createWorkflow` / `createStep`) mirroring the current graph. Parallel fan-out (`translate ∥ chapters ∥ metadata ∥ embeddings`) maps to Mastra parallel/nested-workflow primitives; the 50+ language sub-fan-out preserves `p-limit`-style concurrency caps and OpenRouter rate-limit behavior.
- Trigger is **async**: Manager creates the Admin job, calls Mastra to start a run (gets a `runId`), and Mastra writes progress back to the job record. Manager never blocks on completion.
- The embeddings and scene-embedding workflows that already live on Mastra are **composed in directly** rather than invoked over HTTP.

## Outstanding Questions

### Resolve Before Planning

_(none — all product decisions resolved)_

### Deferred to Planning

- [Affects R7][Needs research] How does Mastra execute long-running HTTP-triggered workflows — blocking request vs. `runId` + async status API? Confirm the async-run + progress-write model can replace the durable `workflow` SDK for many-minute multi-language runs.
- [Affects R2][Technical] Where does shared service code live — move into `apps/mastra/src/`, or extract a shared package consumed by both? **Grep for other Manager consumers** of each service before deciding.
- [Affects R5][Technical] Map the `workflow` SDK's durability guarantees (step checkpointing, resume-on-crash, idempotent re-run) to Mastra primitives (suspend/resume, `.dountil`/`.foreach`, PG store). Confirm resume-from-failed-step parity.
- [Affects R2][Technical] Model the parallel fan-out and 50+ language sub-fan-out in Mastra primitives while preserving concurrency caps and rate-limit behavior.
- [Affects R4][Technical] Exact write-back mechanism: Mastra owns an Admin GraphQL job client, vs. Mastra calls a thin Manager status-callback endpoint. Pick one seam.
- [Affects R3][Technical] Rebind the automation runner's `"runVideoEnrichment"` string-name registry entry (and every other trigger site) to the Mastra trigger. Enumerate and rebind each.
- [Affects R5][Technical] Preserve S3-artifact caching / skip-if-exists idempotency so re-runs don't redo completed work.
- [Affects R7][Technical] Cutover safety mechanism: an engine feature flag (e.g. `ENRICHMENT_ENGINE=workflow|mastra`) enabling side-by-side runs + instant rollback + golden-output diffing during validation.
- [Affects R5][Needs research] Cost/latency parity — confirm per-video LLM cost and wall-clock don't regress under Mastra's execution model.
- [Affects R3/R4][Technical] Auth/keys: which `MASTRA_SERVICE_API_KEYS` entry for the trigger and which Admin API key var for job write-back; honor receiver-deploys-key-first ordering (per CLAUDE.md cross-app trigger pattern).
- [Affects R6][Technical] Itemize the sanctioned opportunistic fixes actually worth taking, each verified output-neutral.

## Next Steps

→ `/ce:plan` for structured implementation planning
