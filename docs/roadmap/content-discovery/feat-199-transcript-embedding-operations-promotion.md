---
id: "feat-199"
title: "Transcript embedding operations, promotion, and source coverage"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-06-30"
duration: 5
depends_on:
  - "feat-192"
blocks: []
tags:
  - "admin"
  - "mastra"
  - "manager"
  - "search"
  - "embeddings"
  - "operator-tools"
  - "content-discovery"
  - "reliability"
---

## Problem

Feat-192 moved semantic-video retrieval to enriched transcript chunks and the
all-language replacement backfill completed, but the production workflow is
still too fragile for the next relevance-affecting backfill.

Search currently reads the live transcript rows matching provider/model, so a
backfill can change production ranking while it is still running. Operators can
trigger the GraphQL mutation, but there is no broad surface that safely starts,
resumes, pauses/cancels, monitors, promotes, or cleans up a full-library,
all-language transcript embedding generation. Source gaps such as
`dub_without_timed_text` and `subtitle_missing` are reported, but they do not
yet roll into a clear source-coverage workflow. Transient Manager artifact read
errors such as `Request is canceled` can also fan out across a batch instead of
isolating to the affected target.

This ticket is the operational vertical slice: from source resolution, through
all-language backfill execution, to staged promotion and cleanup.

## What To Build

1. Add an explicit transcript embedding generation model.
   - Every backfill run writes rows with a generation identity such as
     `generationId` / `backfillRunId` plus provider, model, dimensions,
     source hash, and transcript enrichment version.
   - Search reads only the active generation for a provider/model contract.
   - New generations can be written and evaluated without becoming
     search-visible.
   - Promotion switches the active generation atomically after eval/review.
   - Rollback can restore the previous active generation without re-embedding.
2. Build an operator surface for full-library transcript embedding backfills.
   - Trigger the full default scope: all eligible videos, editions, and
     languages. Do not silently scope to a single `coreId` or language unless
     the operator chooses an explicit filter.
   - Show run id, generation id, mode, provider/model, started/completed/failed
     counts, source gaps, skips, retryable failures, and current throughput.
   - Support resume/retry from the latest known failure point without
     re-embedding completed targets in the same generation.
   - Support cancel/pause semantics that leave completed targets durable and
     resumable.
3. Make cleanup a first-class operation.
   - Provide a dry-run summary before deleting or archiving superseded
     transcript rows/chunks.
   - Delete only generations that are not active, not the rollback generation,
     and older than the approved retention window.
   - If legacy provider/model rows exist in a future run, report exact counts
     before cleanup. The 2026-06-29 completion audit documented zero legacy
     OpenAI transcript parents/chunks, so this is a future safety path rather
     than an immediate destructive task.
4. Close source coverage gaps.
   - Keep the source order from feat-192: Admin/Core subtitles first, Manager
     transcript artifacts second.
   - For dubs with no usable timed text, check Manager transcript enrichment
     before skipping.
   - Report `dub_without_timed_text`, `subtitle_missing`,
     `manager_artifact_missing`, and related gaps with enough identifiers for
     an operator to trigger Manager enrichment separately.
   - Do not auto-trigger costly Manager enrichment as a side effect of a
     backfill. The surface can prepare/export the trigger list, but automatic
     dispatch remains a separate decision.
5. Isolate Manager artifact read failures per target.
   - A single `readManagerArtifact(assetId, "transcript", "json")` cancellation
     or transient network error should log and retry/fail the affected target,
     not poison every target sharing the same batch.
   - Shared artifact caching/memoization must not cache rejected/canceled
     promises in a way that cascades failures.
   - Retryable artifact read failures should use bounded retries with sanitized
     operator-visible reasons.
6. Persist an audit trail.
   - Store enough run state to answer: what generation was produced, what rows
     were written, what source gaps remain, what failed, what was retried, what
     was promoted, and what was cleaned up.
   - Keep logs safe to paste: no subtitle URLs, bearer tokens, vector literals,
     raw provider responses, or database URLs.

## Entry Points - Read These First

- `apps/admin/src/graphql/mutations/transcript-embedding.ts` - current
  GraphQL trigger for transcript embedding backfills.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` - full backfill
  orchestration, source gaps, reports, and completion accounting.
- `apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts` -
  per-group launch/confirm/failure boundaries.
- `apps/admin/src/services/mastra-transcript-embedding-client.ts` - Admin to
  Mastra launch client.
- `apps/mastra/src/mastra/workflows/transcript-embedding.ts` - target planning,
  chunk enrichment, embedding generation, and Admin ingest submission.
- `apps/admin/src/services/transcript-embedding.service.ts` - transcript row
  and chunk writes.
- `apps/admin/src/services/manager-artifacts.service.ts` - Manager artifact
  read boundary and error classification.
- `apps/admin/src/scripts/run-embeds.ts` - existing operator script behavior to
  either preserve or replace with the new surface.
- `docs/solutions/workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md`
  - completed backfill audit and known operational failure shapes.
- `docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md`
  - transcript-backed semantic-video contract.

## Grep These

- `rg -n "triggerTranscriptEmbeddingBackfill|runTranscriptEmbeddingBackfill|TranscriptEmbeddingBackfill" apps/admin/src`
- `rg -n "generationMode|MODEL_UPGRADE|IDEMPOTENT|backfillRunId|callerRunId|sourceHash" apps/admin/src apps/mastra/src`
- `rg -n "sourceGap|dub_without_timed_text|subtitle_missing|manager_artifact" apps/admin/src`
- `rg -n "readManagerArtifact|Request is canceled|artifact_missing|artifact_read_failed" apps/admin/src`
- `rg -n "provider|model|dimensions|active generation|embedding generation" apps/admin/prisma apps/admin/src docs`

## Constraints

- Do not re-enable scene retrieval or scene embedding backfills.
- Do not make search read a staged generation before explicit promotion.
- Do not start a full re-embed from scratch when a resumable generation exists.
- Do not delete active or rollback transcript embeddings.
- Do not auto-trigger Manager enrichment as an implicit side effect of
  embedding backfill.
- Preserve the existing GraphQL trigger until the operator surface fully
  replaces it; scripts and existing callers must keep working during migration.
- Keep frontend search APIs unchanged. This is an Admin/Mastra/operator
  workflow slice.

## Acceptance Criteria

- Operators can start a full-library, all-language transcript embedding run
  from a supported surface and see durable progress without using ad hoc
  GraphQL calls.
- A stopped or failed run can resume idempotently from completed target state
  for the same generation.
- Search reads only the active transcript embedding generation.
- A newly completed generation can be evaluated, promoted atomically, and
  rolled back without re-embedding.
- Cleanup can dry-run and then remove only approved superseded generations.
- Source gap reporting distinguishes missing subtitles/timed text from missing
  Manager artifacts and exports the identifiers needed for a separate Manager
  enrichment trigger.
- A single canceled/transient Manager artifact read does not fail an entire
  batch of unrelated targets.
- Production logs and stored run state are safe to paste and sufficient for an
  operator to know what remains.

## Verification

- Unit tests cover generation selection, active-generation search filtering,
  promotion, rollback, and cleanup guards.
- Workflow tests cover full-scope default enumeration, explicit filters,
  idempotent resume, cancel/pause, source gap reporting, and per-target
  artifact failure isolation.
- Operator-surface tests cover trigger, progress polling, retry, cancel, dry
  cleanup, and promotion flows.
- A production-like dry run shows all-language/full-library scope before
  dispatch.
- A small scoped generation is written staged, verified invisible to search,
  promoted, observed by search, rolled back, and then cleaned up after dry-run
  confirmation.
