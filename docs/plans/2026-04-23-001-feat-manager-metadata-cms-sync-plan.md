---
title: "feat: Sync manager metadata into CMS keywords"
type: feat
status: active
date: 2026-04-23
origin: docs/roadmap/topic-experiences/feat-002-wire-enrichment-metadata-to-cms.md
---

# feat: Sync manager metadata into CMS keywords

## Overview

`feat-002` should turn manager-generated enrichment metadata into first-class CMS records that downstream search, filtering, and topic-generation work can reuse. On `origin/planning`, the metadata pipeline already writes `metadata.json` artifacts, the CMS already has `Keyword` and `Video.keywords` relations, and the manager already has a dormant `notifyCms` / `cms_notify` lane. The missing piece is a repo-native sync path that attaches manager-authored keywords to the correct CMS video without colliding with core-sync ownership rules.

## Problem Frame

The roadmap ticket is directionally correct but no longer matches the planning-branch architecture in a few important ways:

1. Manager CMS writes should follow the existing GraphQL client pattern in `apps/manager/src/cms/client.ts`, not add fresh Strapi REST usage.
2. The workflow already has an existing `notifyCms` concept and `cms_notify` step name. Adding a separate `metadataSync` step would duplicate that lane unless implementation proves it is insufficient.
3. `Keyword.coreId` is required and unique, so manager-authored keyword/topic/speaker rows need stable synthetic IDs rather than blank values.
4. `EnrichmentJob` already has a `video` relation in CMS, which is the right place to persist the target video for downstream metadata sync. The current manager state layer simply does not use it yet.
5. Overwriting `Video.title` / `description` from manager metadata would fight the current core-owned video model. This slice should focus on keyword relations plus `aiMetadata`, not replace canonical video text.

## Requirements Trace

- R1. Manager metadata artifacts sync into CMS records tied to the correct `Video`
- R2. Tags, topics, and speakers become idempotent manager-owned keyword relations
- R3. The workflow exposes CMS sync as a real optional step, using the existing notify-CMS lane
- R4. Re-running enrichment does not duplicate keywords or break core-sync ownership rules
- R5. CMS schema changes regenerate GraphQL types in the same PR
- R6. Verification proves both sync behavior and re-run idempotency

## Scope Boundaries

- Only `apps/manager`, `apps/cms`, and generated GraphQL contract output are in scope
- This slice syncs manager metadata to existing CMS videos only; it does not create new videos
- This slice does not overwrite core-authored `Video.title`, `Video.description`, or other core-managed localized fields
- This slice does not add separate Topic or Speaker content types
- This slice does not broaden `/api/jobs` ingest-from-URL flows to support CMS sync unless a related video is explicitly present
- Search UI, report UI, and topic-generation consumers stay unchanged in this ticket

## Context & Research

### Relevant Code and Patterns

- `apps/manager/src/services/metadata.ts` already extracts and persists `metadata.json`
- `apps/manager/src/services/storage.ts` already exposes `readArtifact(...)` for replayable sync inputs
- `apps/manager/src/workflows/videoEnrichment.ts` currently runs `metadata` in parallel and already has a reserved downstream `cms_notify` concept in manager types/UI
- `apps/manager/src/app/api/enrich/route.ts` already looks up the target CMS video and has the data needed to persist the `EnrichmentJob.video` relation
- `apps/manager/src/lib/state.ts` is the existing typed GraphQL write path to Strapi from manager
- `apps/cms/src/api/keyword/content-types/keyword/schema.json` and `apps/cms/src/api/video/content-types/video/schema.json` already provide the relation model to reuse
- `apps/cms/src/api/core-sync/services/strapi-helpers.ts` and `apps/cms/src/api/core-sync/services/bulk-upsert.ts` already preserve manager-owned records by skipping `source === "manager"` during core sync

### Institutional Learnings

- `docs/solutions/platform/videoforge-manager-integration.md` documents manager’s intended CMS integration path through `@forge/graphql`
- Core-sync’s `source === "manager"` skip behavior is already encoded in CMS sync helpers, so manager-authored metadata should lean on that ownership model rather than inventing a parallel source-of-truth

## Key Technical Decisions

- **Use GraphQL mutations from manager, not Strapi REST.**
  The roadmap ticket predates the current manager GraphQL client pattern. New CMS writes should follow `apps/manager/src/cms/client.ts` plus typed operations in manager/state-layer modules.

- **Reuse `cms_notify` / `notifyCms` as the workflow-facing step name.**
  The planning branch already contains this option and step label. This implementation should turn that placeholder into real metadata sync rather than add a second CMS-sync vocabulary unless code-level constraints force a rename.

- **Represent tags, topics, and speakers with the existing `Keyword` model plus a new `type` enum.**
  Reusing `Video.keywords` keeps the first slice small and avoids adding fresh `Video.speakers` storage. `Keyword.type` should distinguish `"keyword"`, `"topic"`, and `"speaker"`.

- **Generate stable synthetic `coreId` values for manager keywords.**
  Because `Keyword.coreId` is required + unique, manager-owned records need deterministic IDs such as `manager:<type>:<language-core-id>:<normalized-value>`. This preserves idempotency and lets core-sync continue skipping manager-owned rows safely.

- **Persist and reuse the target video through `EnrichmentJob.video`.**
  The CMS schema already has this relation. `/api/enrich` should create jobs with the related video attached, and the sync step should resolve that relation from job state rather than trying to rediscover the video from raw artifact storage.

- **Only mark `Video.aiMetadata` and keyword relations in this slice.**
  AI-generated title/description text should remain artifact-only for now so manager does not overwrite core-managed video text fields. If editorially-visible text sync is desired later, it should land as a follow-up ticket with explicit ownership rules.

## Open Questions

### Resolved During Planning

- **Should this add a new `metadataSync` step?**
  No by default. The planning branch already has `notifyCms` and `cms_notify`, so the implementation should extend that existing lane.

- **How does the workflow know which video to update?**
  Use the existing `EnrichmentJob.video` relation and thread it through manager state + job creation.

- **Where should speakers live?**
  Use the existing `Keyword` relation with `type: "speaker"` for this slice.

### Deferred to Implementation

- **Normalization details for synthetic keyword IDs**
  Implementers should choose one shared normalizer for case-folding, whitespace collapse, and punctuation stripping, then use it consistently for both read and write paths.

- **Whether to expose synced keyword types in current manager APIs**
  This ticket does not require new read APIs; only add them if verification or operator workflows need them during implementation.

## High-Level Technical Design

> This is directional guidance for implementation, not code to reproduce verbatim.

1. `/api/enrich` creates an `EnrichmentJob` that includes the target `video` relation and `notifyCms: true` intent for jobs launched against existing CMS videos.
2. The workflow keeps metadata extraction where it is today, then conditionally runs `cms_notify` after `metadata` completes successfully.
3. The CMS-sync step reads the structured metadata artifact (or receives the parsed metadata directly), loads the related job/video context, and upserts manager-owned keywords by stable synthetic `coreId`.
4. The step updates the target `Video` by setting `keywords` to the merged manager keyword relation set and `aiMetadata` to `true`.
5. Re-runs find the same synthetic IDs, update the same keyword rows, and leave relation counts stable.

## Implementation Units

- [ ] **Unit 1: Extend CMS schema/contracts for typed manager keywords**

  **Goal:** Make the CMS contract capable of distinguishing manager-created keywords, topics, and speakers.

  **Requirements:** R2, R5

  **Dependencies:** None

  **Files:**
  - Modify: `apps/cms/src/api/keyword/content-types/keyword/schema.json`
  - Modify: `apps/cms/schema.graphql`
  - Modify: `packages/graphql/src/graphql-env.d.ts`

  **Approach:**
  - Add `Keyword.type` enum with `"keyword" | "topic" | "speaker"` and default `"keyword"`
  - Keep `source` as the ownership discriminator (`"core"` vs `"manager"`)
  - Regenerate GraphQL types immediately after the schema change

  **Patterns to follow:**
  - Existing enum usage in CMS schema JSON
  - Repo rule: generated GraphQL outputs land in the same PR as CMS schema changes

  **Test scenarios:**
  - GraphQL schema exposes `Keyword.type`
  - Generated types include the new field/input enum

- [ ] **Unit 2: Persist video + CMS-sync intent in manager job state**

  **Goal:** Ensure enrichment jobs launched for existing CMS videos retain enough context for downstream metadata sync.

  **Requirements:** R1, R3

  **Dependencies:** Unit 1 not required

  **Files:**
  - Modify: `apps/manager/src/app/api/enrich/route.ts`
  - Modify: `apps/manager/src/lib/state.ts`
  - Modify: `apps/manager/src/types/job.ts`
  - Modify: `apps/cms/src/api/enrichment-job/content-types/enrichment-job/schema.json` only if the current GraphQL input/output shape is missing required job-option fields
  - Add/modify tests: `apps/manager/src/app/api/enrich/route.test.ts`, `apps/manager/src/lib/state.test.ts`

  **Approach:**
  - Update manager’s create-job path to accept an optional `videoDocumentId` / `videoCoreId` context and `notifyCms` option
  - Attach the related CMS video when `/api/enrich` creates a job for an existing video
  - Surface `notifyCms` and video identity in the manager state mapping if the workflow needs them later
  - Keep `/api/jobs` out of scope unless it has a valid related CMS video

  **Patterns to follow:**
  - Existing GraphQL job creation in `apps/manager/src/lib/state.ts`
  - Existing `notifyCms` option names in `apps/manager/src/types/job.ts` and `apps/manager/src/app/dashboard/jobs/new-job-form.tsx`

  **Test scenarios:**
  - `/api/enrich` stores the target video relation on the created job
  - Jobs without a related video do not attempt CMS sync
  - Existing non-CMS job flows keep working unchanged

- [ ] **Unit 3: Implement manager-side metadata-to-CMS sync service**

  **Goal:** Upsert typed manager keywords and attach them to the target video idempotently.

  **Requirements:** R1, R2, R4

  **Dependencies:** Units 1 and 2

  **Files:**
  - Modify: `apps/manager/src/services/metadata.ts` or add a focused companion module such as `apps/manager/src/services/metadata-sync.ts`
  - Modify: `apps/manager/src/cms/client.ts` only if auth/query helpers are insufficient
  - Add tests: `apps/manager/src/services/metadata-sync.test.ts`

  **Approach:**
  - Load parsed metadata from the existing extraction result or `readArtifact(assetId, "metadata", "json")`
  - Normalize tags/topics/speakers into one typed keyword list
  - Generate stable synthetic `coreId` values for manager records
  - Query existing manager/core keywords as needed, then create or update manager-owned keyword rows via GraphQL mutations
  - Merge the resulting keyword document IDs onto the target `Video.keywords` relation and set `aiMetadata: true`
  - Never overwrite `Video.title` / `description` in this slice

  **Patterns to follow:**
  - Existing manager GraphQL mutation style in `apps/manager/src/lib/state.ts`
  - Existing artifact IO pattern in `apps/manager/src/services/storage.ts`
  - Existing manager-ownership preservation logic in CMS core-sync helpers

  **Test scenarios:**
  - First sync creates manager-owned keywords for tags/topics/speakers
  - Second sync reuses the same synthetic IDs and does not duplicate keyword rows
  - Existing core-owned keywords on a video remain attached after manager sync
  - `aiMetadata` flips to `true` only after a successful sync

- [ ] **Unit 4: Wire the workflow + UI step through `cms_notify`**

  **Goal:** Make CMS sync a visible optional workflow phase that runs after metadata extraction.

  **Requirements:** R3, R4

  **Dependencies:** Units 2 and 3

  **Files:**
  - Modify: `apps/manager/src/workflows/videoEnrichment.ts`
  - Modify: `apps/manager/src/lib/workflow-steps.ts`
  - Modify: `apps/manager/src/types/job.ts`
  - Modify: `apps/cms/src/components/enrichment/job-step.json`
  - Modify: `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  - Add/modify tests: `apps/manager/src/workflows/videoEnrichment.test.ts`

  **Approach:**
  - Add `cms_notify` to the initial step set only for jobs that opt into CMS sync, or explicitly mark it skipped when not requested
  - Run the step after metadata succeeds and before the job is marked complete
  - Ensure failures record on the `cms_notify` step rather than being misattributed to `metadata`
  - Reuse the existing step description/UI lane instead of inventing a second CMS sync label

  **Test scenarios:**
  - `notifyCms: true` runs the CMS sync step after metadata
  - `notifyCms: false` skips or omits the step deterministically
  - CMS sync failure marks only `cms_notify` failed and leaves prior completed steps intact

- [ ] **Unit 5: End-to-end verification**

  **Goal:** Prove real CMS linkage and re-run idempotency.

  **Requirements:** R6

  **Dependencies:** Units 1-4

  **Files:**
  - No required code changes

  **Approach:**
  - Run an enrichment job against an existing CMS-backed video via `/api/enrich`
  - Query the target video through manager/CMS GraphQL and confirm `keywords` + `aiMetadata`
  - Re-run the same job and confirm keyword row counts stay stable
  - Confirm core-sync still preserves manager-owned keywords on a subsequent sync dry run or characterization test

  **Verification:**
  - Manager/CMS query shows typed manager keywords attached to the correct video
  - `aiMetadata` is `true` after sync
  - Re-run does not create duplicate manager keyword rows

## System-Wide Impact

- **Manager workflow:** gains a real post-metadata CMS sync phase for jobs tied to existing videos
- **CMS contract:** `Keyword` gains a type discriminator, and generated GraphQL types change accordingly
- **Core-sync interaction:** unchanged by design except that manager-owned keywords now participate in the existing skip/preservation rules
- **Operator UX:** existing `Notify CMS (Strapi)` language becomes truthful for enrichment jobs launched from existing videos

## Risks & Dependencies

- **Risk: synthetic keyword IDs drift** — inconsistent normalization would break idempotency. Mitigation: one shared normalization helper with test coverage.
- **Risk: relation replacement drops existing keywords** — a naive `updateVideo(keywords: [...])` could blow away existing relations. Mitigation: load current keyword IDs first and merge manager additions deterministically.
- **Risk: planning-branch drift around CMS gateway abstraction** — `apps/manager/AGENTS.md` references `src/cms/gateway.ts`, but `origin/planning` still uses `src/cms/client.ts`. Mitigation: implement against current planning-branch code and only introduce a gateway if the branch adds it during execution.
- **Dependency: GraphQL regeneration** — required immediately after CMS schema changes.

## Sources & References

- Origin ticket: `docs/roadmap/topic-experiences/feat-002-wire-enrichment-metadata-to-cms.md`
- Related code:
  - `apps/manager/src/services/metadata.ts`
  - `apps/manager/src/services/storage.ts`
  - `apps/manager/src/workflows/videoEnrichment.ts`
  - `apps/manager/src/app/api/enrich/route.ts`
  - `apps/manager/src/lib/state.ts`
  - `apps/cms/src/api/keyword/content-types/keyword/schema.json`
  - `apps/cms/src/api/enrichment-job/content-types/enrichment-job/schema.json`
  - `apps/cms/src/api/core-sync/services/strapi-helpers.ts`
- Related learning: `docs/solutions/platform/videoforge-manager-integration.md`
