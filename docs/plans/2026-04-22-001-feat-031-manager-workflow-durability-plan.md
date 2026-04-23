---
title: "feat: Make the manager video enrichment workflow actually durable"
type: feat
status: active
date: 2026-04-22
origin: docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# feat: Make the manager video enrichment workflow actually durable

## Overview

Plan the next narrow slice for `feat-031`: wire the existing `apps/manager` video enrichment pipeline into a real workflow runtime so `runVideoEnrichment()` is no longer just a plain async function launched from a request handler. This slice is about durable execution for the current five-step pipeline, not about adding new enrichment capabilities.

## Problem Frame

`feat-031` is marked `in-progress`, and the current manager app already contains step orchestration for transcription, translation, chapters, metadata, and embeddings. But the code explicitly says the `"use workflow"` / `"use step"` directives are inert because `apps/manager/next.config.ts` does not enable the workflow build plugin, and both API entrypoints still launch the full pipeline via `after(async () => runVideoEnrichment(...))`.

That means the pipeline currently behaves like best-effort background work tied to the request lifecycle instead of a durable workflow. A restart, deployment, or runtime interruption can strand jobs mid-run even though operator-visible job state already lives in Strapi. This leaves a core part of `feat-031` incomplete. (see origin: `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`)

## Requirements Trace

- R1. The existing enrichment pipeline in `apps/manager` must execute through real workflow-runtime semantics rather than direct inline async work.
- R2. Keep the implementation bounded to the current five-step pipeline: transcription, translation, chapters, metadata, embeddings.
- R3. Preserve Strapi-backed `EnrichmentJob` records in `apps/manager/src/lib/state.ts` as the operator-facing source of truth.
- R4. Both `POST /api/jobs` and `POST /api/enrich` must launch work through the same shared path.
- R5. Verification must prove the runtime launch path works without regressing job-state updates or route behavior.

## Scope Boundaries

- No voiceover/TTS work. That belongs to `feat-014` even though older manager docs mention it in the broader pipeline vision.
- No new dashboard surface beyond whatever existing job-state fields already show.
- No new CMS schema or GraphQL codegen work unless runtime integration proves an unavoidable persistence gap.
- No rewrite of the enrichment services themselves.
- No new queueing system beyond the workflow runtime already intended for this app.

## Context & Research

### Relevant Code and Patterns

- `apps/manager/src/workflows/videoEnrichment.ts`
  The orchestration logic already exists, but the file header documents that durability is disabled until the workflow plugin is configured.
- `apps/manager/src/app/api/jobs/route.ts`
  Creates a Mux asset and then runs the entire enrichment pipeline inside `after(...)`.
- `apps/manager/src/app/api/enrich/route.ts`
  Creates batch jobs from CMS videos and duplicates the same direct `after(...)` launch pattern.
- `apps/manager/next.config.ts`
  Still exports a minimal Next config with no workflow build plugin.
- `apps/manager/src/config/env.ts`
  Already defines `WORKFLOW_API_KEY`, so the app has started the env contract for durable execution.
- `apps/manager/src/lib/state.ts`
  Job progress already persists in Strapi and should remain the canonical operator view during this slice.
- `docs/solutions/platform/videoforge-manager-integration.md`
  Records the intended durable-workflow architecture and confirms this was part of the original manager direction, even though the current code has not fully closed the loop.
- `docs/plans/2026-03-17-001-feat-videoforge-manager-full-port-plan.md`
  Older broad manager plan. Useful for context, but too wide to drive the next safe step on `feat-031`.

### Institutional Learnings

- The manager app already treats workflow steps as idempotent; that should remain the contract once the runtime is actually enabled.
- `after()` is acceptable for post-response launch bookkeeping, but it is not a substitute for durable orchestration.
- The repo already prefers keeping operator-visible truth in existing persisted state rather than inventing a second shadow status store.

## Key Technical Decisions

- **Create one shared launcher abstraction.**
  Add `apps/manager/src/workflows/launchVideoEnrichment.ts` as the only place API routes trigger the workflow runtime. This removes duplicated launch logic from the routes and isolates SDK-specific wiring to one module.

- **Enable the workflow plugin in `apps/manager/next.config.ts`.**
  This slice should turn on the build/runtime path that makes `"use workflow"` and `"use step"` real. Leaving durability behind a silent missing-plugin state would keep `feat-031` misleadingly "in progress" without closing the core gap.

- **Keep Strapi `EnrichmentJob` as the canonical job record.**
  Do not add a second durable-job table in this slice. The runtime handles execution durability; Strapi remains the UI-facing state and audit surface.

- **Retain the existing five workflow steps.**
  Do not add `voiceover`, `mux_upload`, or `cms_notify` while enabling durability. Finishing execution semantics is already enough scope for one PR-sized slice.

- **Use an explicit local-fallback policy instead of accidental direct execution.**
  The implementation should not silently fall back to inline async work just because runtime wiring is missing. If local development needs a non-durable path, make that choice explicit in the launcher and document it clearly. Production/staging should fail loudly when durability is expected but unavailable.

## Open Questions

### Resolved During Planning

- **Should this slice include voiceover because older manager docs mention it?**
  No. `feat-014` exists as a separate roadmap ticket, and this run should not merge ticket scope.

- **Should both API routes keep their own launch logic?**
  No. They should converge on a single launcher helper so the runtime integration, error handling, and fallback policy live in one place.

- **Should this slice add new CMS fields for workflow-run identifiers?**
  Not initially. The smallest safe slice is to enable durable execution while continuing to use the existing `EnrichmentJob` record.

### Deferred To Implementation

- **Exact SDK hook-up details for `workflow@4.2.0-beta.70`.**
  Confirm the concrete plugin and launcher API from the installed package while implementing, but keep that uncertainty boxed inside `launchVideoEnrichment.ts` and `next.config.ts`.

- **Whether the current parallel `Promise.all(...)` block should remain a single orchestration segment or be broken into smaller runtime-managed units.**
  Start by preserving the current step boundaries. If the SDK makes that pattern awkward, treat finer-grained fan-out as follow-up work rather than broadening this slice.

## Implementation Units

- [ ] **Unit 1: Enable the workflow runtime in the manager build**

  **Goal:** Make the manager app compile the enrichment workflow through the intended workflow runtime instead of leaving directive strings inert.

  **Requirements:** R1, R5

  **Dependencies:** None

  **Files:**
  - Modify: `apps/manager/next.config.ts`
  - Modify: `apps/manager/src/config/env.ts` (only if the SDK requires additional env wiring beyond `WORKFLOW_API_KEY`)

  **Approach:**
  - Add the workflow build plugin to the Next.js config for `apps/manager`
  - Keep the config change isolated to manager; do not change root monorepo build settings
  - Preserve existing `output: "standalone"` and `typedRoutes` behavior
  - Make missing runtime configuration explicit instead of silently leaving the workflow as plain async code

  **Verification:**
  - `pnpm --filter @forge/manager typecheck`
  - `pnpm --filter @forge/manager build`
  - Build output no longer relies on the "plugin missing" condition described in `videoEnrichment.ts`

- [ ] **Unit 2: Centralize workflow launching behind one shared helper**

  **Goal:** Replace duplicated direct invocation logic with a single launch path that can own runtime integration, local fallback policy, and launch-time error handling.

  **Requirements:** R1, R3, R4

  **Dependencies:** Unit 1

  **Files:**
  - Create: `apps/manager/src/workflows/launchVideoEnrichment.ts`
  - Modify: `apps/manager/src/workflows/videoEnrichment.ts`

  **Approach:**
  - Define a shared launcher function that accepts the existing `VideoEnrichmentInput`
  - Keep `runVideoEnrichment()` responsible for orchestration logic only
  - Move runtime-specific trigger code out of route handlers and into the launcher
  - Normalize launch failures so callers can mark jobs failed or surface an actionable operator error without duplicating that logic
  - If a direct local-development fallback is retained, make the mode explicit in code and logs

  **Verification:**
  - `apps/manager/src/workflows/videoEnrichment.ts` no longer has to double as both runtime entrypoint and route-launch surface
  - Launcher compiles cleanly and is the only workflow trigger path used by routes

- [ ] **Unit 3: Switch both API entrypoints to the shared launcher**

  **Goal:** Ensure every enrichment job enters the durable runtime the same way, whether it starts from a raw input URL or a CMS video selection.

  **Requirements:** R3, R4, R5

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `apps/manager/src/app/api/jobs/route.ts`
  - Modify: `apps/manager/src/app/api/enrich/route.ts`

  **Approach:**
  - Replace direct `after(async () => runVideoEnrichment(...))` calls with the launcher helper
  - Keep route handlers focused on auth, validation, lookup/ingest, and job creation
  - If `after()` is still needed, use it only to enqueue/trigger the runtime launch, not to host the entire pipeline body
  - Keep job creation semantics unchanged so the dashboard and existing polling behavior continue to work

  **Verification:**
  - Both endpoints compile and call the same launcher
  - Launch-time failures produce a clear job failure path instead of leaving a silently pending job
  - Existing response shapes stay stable

- [ ] **Unit 4: Align manager docs with the post-change runtime truth**

  **Goal:** Remove the current mismatch where manager docs describe durable workflows while the code comments still say the runtime is inert.

  **Requirements:** R5

  **Dependencies:** Unit 3

  **Files:**
  - Modify: `apps/manager/CLAUDE.md`
  - Modify: `docs/solutions/platform/videoforge-manager-integration.md`

  **Approach:**
  - Update manager guidance to state the actual runtime requirement and launch path after implementation lands
  - Keep the solution doc honest about what is now durable versus what remains future work

  **Verification:**
  - Repo docs no longer contradict the implementation state of `feat-031`

## System-Wide Impact

- Primary impact is limited to `apps/manager`
- No expected `apps/cms` or `packages/graphql` changes in the first slice
- Railway manager deploys will need the runtime env configuration to stay valid once durability is enabled for real

## Risks & Mitigations

- **Workflow SDK API drift or unclear package ergonomics**
  Keep all SDK-specific code inside the launcher helper and `next.config.ts` so the rest of the manager code stays stable.

- **Build/runtime surprises after enabling the plugin**
  Validate with a real manager build in the implementation phase instead of relying on typecheck alone.

- **Silent local fallback reintroduces the same durability gap**
  Make any fallback explicit and development-only. Production/staging should fail closed if runtime configuration is missing.

- **Current parallel step fan-out may not map perfectly to runtime checkpoints**
  Preserve the current shape first. If finer-grained runtime fan-out is needed, capture it as a follow-up instead of expanding this ticket slice mid-run.

## Verification Strategy

- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager build`
- Manual smoke test against manager:
  - create a job through `POST /api/jobs` or `POST /api/enrich`
  - confirm the route returns quickly after job creation
  - confirm the job enters the shared launch path
  - confirm Strapi-backed step state still transitions through running/completed or failed

## Sources & References

- Origin ticket: `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
- Existing manager plan: `docs/plans/2026-03-17-001-feat-videoforge-manager-full-port-plan.md`
- Existing manager solution doc: `docs/solutions/platform/videoforge-manager-integration.md`
