---
title: "Manager job read model: promote source-language metadata from materialization"
category: integration-issues
module: Manager
date: 2026-04-09
problem_type: integration_issue
component: service_object
symptoms:
  - "/api/jobs/:id returned top-level source-language fields as null or missing even when artifacts.materialization.data contained them"
  - "Completed enrich jobs hid sourceLanguageId, sourceLanguageCode, sourceSelectionReason, primaryRequestedTargetLanguageCode, and resolvedTargetLanguageCodes from the main JobRecord payload"
  - "QA and operators could not verify from the normal job response whether enrichment used the requested source language or a fallback source"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - manager
  - jobs-api
  - source-language
  - materialization
  - enrichment
  - qa
  - read-model
  - fallback-selection
affected_components:
  - apps/manager/src/types/job.ts
  - apps/manager/src/lib/state.ts
  - apps/manager/src/lib/state.test.ts
  - apps/manager/src/app/api/jobs/[id]/route.ts
related_docs:
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
  - docs/solutions/integration-issues/manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md
  - docs/plans/2026-04-01-feat-stage-materialization-for-snapshot-enrichment-plan.md
  - docs/plans/2026-04-04-feat-source-language-priority-for-enrichment-plan.md
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/media-generation/feat-047-mux-environment-indicator-on-job-detail.md
---

# Manager job read model: promote source-language metadata from materialization

## Problem

Recent enrichment changes made source-language selection explicit and persisted
that truth into `job.artifacts.materialization.data`, but the normal manager job
API still dropped those fields at the top level.

That created an operator-facing split brain:

- the nested artifact metadata knew which source language was actually
  transcribed
- `/api/jobs/:id` and `JobRecord` did not

In practice, QA could confirm fallback behavior only by manually opening the
`materialization` metadata instead of reading the main job payload.

## Reproduction

Two local QA runs exposed the same drift:

- `suxvaak4p4v0p4bnmvbde8d7`
  - Russian-targeted job
  - `artifacts.materialization.data.sourceLanguageCode` was `"en"`
  - `artifacts.materialization.data.sourceSelectionReason` was
    `"fallback-en"`
  - top-level `/api/jobs/:id` still returned `sourceLanguageCode: null`
- `qsix8zfjtyyzw5ah5r4zfb27`
  - earlier English-targeted run
  - nested materialization metadata still showed `sourceLanguageCode: "en"`
  - top-level job response again dropped the field

## Root Cause

The write path and the read path had drifted apart.

The enrich route in
[route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts)
was already persisting source-selection truth into `artifacts.materialization`,
including:

- `sourceLanguageId`
- `sourceLanguageCode`
- `sourceSelectionReason`
- `primaryRequestedTargetLanguageCode`
- `resolvedTargetLanguageCodes`

But the manager read model ignored that metadata:

- [job.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts)
  did not expose those top-level fields on `JobRecord`
- [state.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/state.ts)
  normalized `artifacts` but did not promote any `materialization` fields into
  the returned read model
- [/api/jobs/[id]/route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/jobs/[id]/route.ts)
  simply returned `getJob(id)`, so the API inherited the incomplete projection

This was not a source-selection bug. The persisted metadata was already
truthful. The bug was that the shared read-model adapter failed to project that
truth onto the top-level API contract.

## Solution

The fix stayed entirely in the manager read layer.

### Extend `JobRecord` with additive source-language fields

[job.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts)
now exposes these optional top-level read-model properties:

- `sourceLanguageId`
- `sourceLanguageCode`
- `sourceSelectionReason`
- `primaryRequestedTargetLanguageCode`
- `resolvedTargetLanguageCodes`

This kept the change additive and avoided any CMS schema migration.

### Normalize artifacts once, then promote `materialization` fields

[state.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/state.ts)
now:

1. normalizes `artifacts` once
2. derives nonblank strings and string arrays from
   `artifacts.materialization.data`
3. spreads those derived fields into the returned `JobRecord`

The key boundary is `deriveMaterializationFields(...)`, which promotes
read-facing provenance fields from the normalized metadata artifact.

Because promotion happens after artifact normalization, both modern object
payloads and older stringified `materialization` payloads resolve to the same
top-level shape.

### Add mapper regression coverage for both shapes

[state.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/state.test.ts)
now covers:

- current object-shaped `materialization` metadata
- legacy stringified `materialization` metadata

That ensures the read model stays aligned with both current and older persisted
jobs.

## Why This Works

The fix reuses the only persisted source of truth that already exists:
`artifacts.materialization.data`.

That matters because the manager job content type intentionally keeps flexible
artifact JSON rather than first-class CMS columns for every enrichment-specific
field. Promoting those values in `toJobRecord(...)` restores the API contract
without expanding scope into:

- Strapi schema changes
- GraphQL regeneration
- UI-only fallback logic

Once `toJobRecord(...)` is correct, every consumer that relies on the shared
read model gets the same truth:

- `/api/jobs/:id`
- list/detail pages that use `JobRecord`
- any future consumers of the manager state helpers

## Verification

Automated verification:

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`

Live QA verification:

- revalidated existing Russian fallback job `suxvaak4p4v0p4bnmvbde8d7`
  - top-level response now returned:
    - `sourceLanguageCode: "en"`
    - `sourceLanguageId: "529"`
    - `sourceSelectionReason: "fallback-en"`
    - `resolvedTargetLanguageCodes: ["ru"]`
- created a fresh Russian-targeted job `flirgfzn5va50nuslgcy0rgs`
  - job completed successfully
  - top-level `/api/jobs/:id` returned the same promoted source-language fields
  - browser QA on the live job page showed completed transcript,
    `subtitles-ru`, `translation-ru`, chapters, metadata, and embeddings
    artifacts

## Prevention

1. Treat `deriveMaterializationFields()` as the single promotion boundary for
   any `materialization` keys intended for API or UI consumers.
2. When `materialization.data` changes in the enrich writer, require the same PR
   to update both `JobRecord` and `toJobRecord(...)`.
3. Keep one explicit promoted-field list for `materialization` metadata instead
   of duplicating string keys across writer, reader, and UI code.
4. Preserve one shared read path for summary and detail responses so job list
   and job detail contracts cannot drift independently.
5. Add contract tests that assert:
   - promoted top-level fields exist when nested materialization fields exist
   - object-shaped and stringified materialization payloads hydrate the same way
   - list and detail job endpoints expose the same promoted source-language
     fields

## Operational Checks

- Canary a recent enrich job after deploy and fail the check if
  `artifacts.materialization.data.sourceLanguageCode` exists but
  `job.sourceLanguageCode` is missing or different.
- Add a low-noise warning for the case:
  - nested provenance field present
  - promoted top-level field absent
- For enrichment QA, verify both:
  - a requested-source job
  - a fallback-source job

Do that through the normal job endpoints, not only by opening nested artifacts.

## Related References

- [Strapi EnrichmentJob content type for durable job state](../cms/strapi-enrichment-job-content-type.md)
- [Manager embeddings: transcript-aware chunking with additive metadata artifact contract](./manager-embeddings-transcript-aware-optional-metadata-2026-04-08.md)
- [Plan: stage materialization for snapshot enrichment](../../plans/2026-04-01-feat-stage-materialization-for-snapshot-enrichment-plan.md)
- [Plan: source-language priority for enrichment](../../plans/2026-04-04-feat-source-language-priority-for-enrichment-plan.md)
- [Roadmap: AI Video Enrichment Pipeline](../../roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
- [Roadmap: Mux environment indicator on job detail](../../roadmap/media-generation/feat-047-mux-environment-indicator-on-job-detail.md)
