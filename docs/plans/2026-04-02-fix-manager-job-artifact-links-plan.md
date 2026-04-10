---
title: "fix: Restore artifact links on manager job detail pages"
type: fix
status: active
date: 2026-04-02
---

# fix: Restore artifact links on manager job detail pages

## Overview

The manager job detail screen renders an Artifacts column per workflow step, but the current subtitle-enrichment pipeline rarely shows any open-in-new-tab icons. The files are being written to storage, but the job record does not consistently expose those artifact keys in the shape the UI expects.

This fix restores the contract between:

- storage writers in `apps/manager/src/services/*`
- durable job state in `apps/manager/src/lib/state.ts`
- the workflow orchestrator in `apps/manager/src/workflows/videoEnrichment.ts`
- the artifact renderer in `apps/manager/src/features/jobs/live-job-steps-table.tsx`

The goal is simple: when a step successfully produces an artifact, the job detail page should show a working link for it.

## 2026-04-04 Audit Update

Most of this fix has landed. The remaining honest gap is manual spot-checking of partially failed jobs in the browser.

The branch now persists artifact manifest entries before marking a step complete, and failed jobs continue to expose whatever artifacts were already written before the failure. What is still not fully documented by QA evidence is the browser-level spot-check for a real partially failed job.

## Problem Statement / Motivation

The current implementation has two mismatches:

1. Files are written to storage, but most returned storage keys are never copied back into `EnrichmentJob.artifacts`.
2. The job detail table still expects older legacy artifact keys such as `subtitlesVtt` and `translations`, while the current workflow writes keys like:
   - `transcript`
   - `subtitles`
   - `chapters`
   - `metadata`
   - `embeddings`
   - `subtitles-{lang}`
   - `translation-{lang}`

As a result:

- completed steps show `–` in the Artifacts column
- QA cannot quickly open transcript, VTT, chapter, metadata, or embedding outputs
- the detail page fails one of the original manager acceptance criteria: artifact links on job detail pages

This bug is especially visible now that stage-materialized QA jobs are being created from the coverage screen and users expect to inspect generated outputs immediately.

## Proposed Solution

Treat `EnrichmentJob.artifacts` as the canonical UI-facing artifact index and explicitly populate it during workflow execution.

### High-level approach

1. Normalize the current workflow artifact contract.
2. Capture returned storage keys from each successful step.
3. Persist those keys onto `EnrichmentJob.artifacts` with stable names.
4. Update the job detail presenter to read the new canonical keys, including translated subtitle outputs.
5. Preserve existing `materialization` provenance metadata rather than replacing it.

### Canonical artifact model

Use `job.artifacts` as a flat, UI-readable map with these baseline keys:

- `transcript`
- `subtitles`
- `chapters`
- `metadata`
- `embeddings`
- `materialization`

For subtitle translation, support per-language entries with explicit names:

- `subtitles-{lang}`
- `translation-{lang}`

This keeps the storage naming and the job-state naming aligned instead of inventing separate presentation-only aliases.

## Technical Considerations

### 1. Service return contracts are inconsistent today

Today several services write artifacts but return only domain data:

- `transcribe()` writes `transcript` and `subtitles`
- `stepChapters()` writes `chapters`
- `stepMetadata()` writes `metadata`
- `stepEmbeddings()` writes `embeddings`
- `translateSubtitles()` already returns per-language artifact keys

The simplest repair is to make each step that writes artifacts return both:

- its domain result
- its artifact key or keys

That keeps the workflow orchestrator responsible for updating durable job state without forcing every service to know about job persistence.

### 2. The orchestrator should merge artifacts incrementally

`runVideoEnrichment()` should update the job after each successful step with:

- existing `job.artifacts`
- plus new keys written by that step

This avoids a “write everything only at the end” design that loses visibility during in-progress jobs.

It also means partially successful jobs still expose the artifacts already produced before a later step fails.

### 3. Translation needs dynamic artifact discovery

Translation is no longer a single `translations` file. It is a per-language fan-out pipeline.

The detail table should stop expecting a single `translations` key and instead render all matching translation artifacts for the current job:

- VTTs: `subtitles-{lang}`
- JSON summaries: `translation-{lang}`

This can be implemented either by:

- replacing static `ARTIFACT_KEYS_BY_STEP.translation` with prefix matching, or
- introducing a small artifact-resolver layer that supports both exact keys and prefix patterns

The second option is preferred because it keeps the transcription and translation cases in one place.

### 4. Preserve compatibility with existing jobs

Older jobs may still have:

- no per-step artifact keys at all
- only `materialization`
- old legacy keys if any prior variant wrote them

The UI should degrade gracefully:

- render nothing when no matching keys exist
- continue to support any older exact keys we already used
- prefer the new canonical keys for fresh jobs

### 5. Artifact URLs vs storage keys

The current UI assumes `job.artifacts[key]` is directly openable as a link. Before implementation, verify whether the stored value should be:

- a raw storage key such as `assetId/transcript.json`, or
- a signed/public URL derived from that key

The plan should follow the existing manager convention rather than introducing a second storage addressing scheme.

If the current UI already expects URL-ready values, add the necessary translation at write/update time. If it expects keys, then the detail route or API must resolve them before rendering links.

### 6. Step-detail query and polling must remain consistent

The job detail page first renders from the server query and then live-polls `/api/jobs/[id]`.

Both data paths must expose artifact data in the same shape, or the page will flicker between:

- working artifact links after polling
- missing artifact links on first load

This same mismatch already happened recently for source titles and should be avoided here too.

## Acceptance Criteria

### Functional Requirements

- [x] Completed transcription steps show artifact links for `transcript` and `subtitles` when present
- [x] Completed chapters steps show an artifact link for `chapters`
- [x] Completed metadata steps show an artifact link for `metadata`
- [x] Completed embeddings steps show an artifact link for `embeddings`
- [x] Completed translation steps show links for every generated `subtitles-{lang}` and `translation-{lang}` artifact
- [x] `materialization` provenance remains stored on the job and is not lost when later artifacts are merged in
- [x] Job detail first render and live polling expose artifact links consistently

### Non-Functional Requirements

- [x] No step loses previously written artifact keys when another step updates the job
- [x] Failed jobs still show links for artifacts produced before failure
- [x] The implementation does not require any CMS schema change

### Quality Gates

- [x] Add unit coverage for artifact-to-step mapping logic
- [x] Add tests for artifact merging so `materialization` and prior keys survive later updates
- [x] Verify browser QA on a real completed job detail page

## Success Metrics

- Newly created enrichment jobs show non-empty artifact links on the job detail page for completed steps
- QA can open transcript, subtitles, chapters, metadata, embeddings, and translated outputs directly from the UI
- No regression in job polling, source summaries, or step status rendering

## Dependencies & Risks

### Dependencies

- Existing `EnrichmentJob.artifacts` JSON field in Strapi
- Existing storage writer behavior in `apps/manager/src/services/storage.ts`
- Existing subtitle translation per-language artifact return shape

### Risks

- If artifact values are raw storage keys instead of browser-openable URLs, links may still render but fail to open usefully
- Naive artifact writes in parallel step completion could overwrite each other if the workflow merges from stale job state
- Translation prefix matching may accidentally capture unrelated keys unless the naming rules stay strict

### Mitigations

- Centralize artifact merge logic in one helper instead of ad hoc `updateJob(...artifacts...)` calls
- Use exact key prefixes (`subtitles-`, `translation-`) and keep `materialization` excluded from step rendering
- Test both first-render and polled job data paths

## Implementation Plan

### Phase 1: Define the canonical artifact contract

- [x] Audit every workflow step that writes artifacts
- [x] Document the canonical `job.artifacts` keys used by the current manager pipeline
- [x] Decide whether artifact values are stored as direct URLs or storage keys requiring resolution

Files to inspect:

- `apps/manager/src/services/transcription.ts`
- `apps/manager/src/services/chapters.ts`
- `apps/manager/src/services/metadata.ts`
- `apps/manager/src/services/embeddings.ts`
- `apps/manager/src/services/subtitleTranslation/index.ts`
- `apps/manager/src/services/storage.ts`

### Phase 2: Return artifact keys from writers and merge them in the workflow

- [x] Update transcription to return written artifact keys alongside transcript data
- [x] Update chapters/metadata/embeddings services to return their written artifact keys
- [x] Add a small helper in the workflow or state layer to merge new artifact entries onto the existing job safely
- [x] Update `runVideoEnrichment()` to persist artifact keys immediately after each successful step

Files expected:

- `apps/manager/src/services/transcription.ts`
- `apps/manager/src/services/chapters.ts`
- `apps/manager/src/services/metadata.ts`
- `apps/manager/src/services/embeddings.ts`
- `apps/manager/src/workflows/videoEnrichment.ts`
- optional helper in `apps/manager/src/lib/state.ts`

### Phase 3: Update the job detail artifact presenter

- [x] Replace outdated legacy translation expectations in `live-job-steps-table.tsx`
- [x] Introduce step artifact resolution that supports:
  - exact keys for single-output steps
  - prefix-based keys for translation outputs
- [x] Keep backward-compatible fallback handling for any legacy keys already in old jobs

Files expected:

- `apps/manager/src/features/jobs/live-job-steps-table.tsx`

### Phase 4: Verify both data paths and browser UX

- [x] Confirm `/api/jobs/[id]` and the server-rendered job detail query expose the same artifact shape
- [x] Run a real enrichment job and verify completed steps show openable artifact icons
- [ ] Spot-check both completed and partially failed jobs

Files expected:

- `apps/manager/src/app/dashboard/jobs/[id]/page.tsx`
- `apps/manager/src/app/api/jobs/[id]/route.ts`

## SpecFlow Analysis

### Main user flow

1. User opens a completed job detail page
2. User scans the Step Execution table
3. User clicks the artifact icon for a completed step
4. Artifact opens in a new tab for QA review

### Edge cases to cover

- Job completed with no translation targets
- Translation completed for one language but failed for another
- Job failed after transcription but before metadata/embeddings
- Older jobs missing the new artifact keys
- Local artifact storage vs non-production bucket storage

### Important decision

This fix should not introduce a new artifact manifest model or CMS schema. The current `artifacts` JSON field is already the intended durable index and should be used correctly.

## References & Research

### Internal References

- Enrichment job content type and intended flexible `artifacts` JSON: `docs/solutions/cms/strapi-enrichment-job-content-type.md`
- Manager platform architecture and artifact storage pattern: `docs/solutions/platform/videoforge-manager-integration.md`
- Original manager plan acceptance criteria for artifact links:
  `docs/plans/2026-03-17-001-feat-videoforge-manager-full-port-plan.md`
- Job detail artifact renderer:
  `apps/manager/src/features/jobs/live-job-steps-table.tsx`
- Durable job state mapping:
  `apps/manager/src/lib/state.ts`
- Workflow orchestrator:
  `apps/manager/src/workflows/videoEnrichment.ts`
- Storage writers:
  `apps/manager/src/services/transcription.ts`
  `apps/manager/src/services/chapters.ts`
  `apps/manager/src/services/metadata.ts`
  `apps/manager/src/services/embeddings.ts`
  `apps/manager/src/services/subtitleTranslation/index.ts`

### Relevant Learnings

- `EnrichmentJob.artifacts` was intentionally designed as flexible JSON rather than a rigid schema, so this fix should prefer contract alignment over new content-type changes.
- The jobs UI has already shown one case of server-query vs live-API drift; artifact data should be verified on both paths during implementation.

## Final Notes

Assumption: this is a manager-only UI/data-contract fix, not a broader artifact browser redesign.

Deliberately out of scope:

- redesigning the artifact icon UX
- adding artifact previews inline
- introducing a new manifest collection type
- backfilling historical jobs beyond graceful fallback handling
