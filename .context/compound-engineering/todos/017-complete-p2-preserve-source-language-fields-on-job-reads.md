---
status: complete
priority: p2
issue_id: "017"
tags: [manager, jobs, api, qa, enrichment]
dependencies: []
---

# Preserve source-language fields on job reads

The job API/read model drops source-language information that is present in enrichment materialization metadata, which makes QA and operators unable to tell what source language was actually transcribed for a completed job.

## Problem Statement

During local QA of completed enrich jobs, `/api/jobs/:id` returned a top-level job payload with missing source-language fields even though the underlying materialization metadata clearly recorded them.

Concrete repro from local dev on 2026-04-09:

- Russian-targeted job `suxvaak4p4v0p4bnmvbde8d7` completed successfully
- `artifacts.materialization.data.sourceLanguageCode` was `"en"`
- `artifacts.materialization.data.sourceSelectionReason` was `"fallback-en"`
- but the top-level job payload still returned `sourceLanguageCode: null`

The same drift was also visible on the earlier English run:

- job `qsix8zfjtyyzw5ah5r4zfb27`
- materialization metadata included `sourceLanguageCode: "en"`
- top-level `/api/jobs/:id` response still exposed `sourceLanguageCode: null`

This matters because recent enrichment changes intentionally made source-language selection more explicit and deterministic. If the job read model drops those fields, the operator cannot verify whether the system:

- used the requested source language
- fell back to `en`, `es`, `fr`, or another supported source
- transcribed the expected audio language

## Findings

- The enrich route persists the real source-selection details into `artifacts.materialization.data` in [route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts).
  - Includes `sourceLanguageId`
  - Includes `sourceLanguageCode`
  - Includes `sourceSelectionReason`
  - Includes `primaryRequestedTargetLanguageCode`
  - Includes `resolvedTargetLanguageCodes`

- The manager job read path does not expose equivalent top-level fields:
  - [job.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts)
    - `JobRecord` does not include source-language/source-selection fields
  - [state.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/state.ts)
    - `JobCoreFields` and `toJobRecord(...)` do not map source-language fields into the read model
  - [route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/jobs/[id]/route.ts)
    - simply returns `getJob(id)` with no recovery or derivation step

- The result is a split-brain job model:
  - `artifacts.materialization.data` contains the truth
  - the top-level API payload loses it

- Operational impact:
  - QA cannot quickly confirm fallback behavior from the main job payload
  - UI/status views can show incomplete or misleading state
  - follow-up debugging requires manually opening nested artifact metadata instead of reading the job summary directly

## Proposed Solutions

### Option 1: Derive source-language fields from materialization metadata on read

**Approach:** Update `toJobRecord(...)` to read `artifacts.materialization.data` and populate read-model fields like `sourceLanguageCode`, `sourceLanguageId`, and `sourceSelectionReason`.

**Pros:**

- Fastest fix
- No CMS schema change required
- Reuses the materialization metadata already persisted today

**Cons:**

- Makes top-level job fields derived rather than first-class persisted data
- Still ties correctness to the artifact metadata contract

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Persist source-language fields as first-class EnrichmentJob fields

**Approach:** Add explicit Strapi/CMS fields for source-language and source-selection data, write them during job creation/update, and expose them directly through GraphQL/state mapping.

**Pros:**

- Cleaner long-term contract
- Source metadata becomes queryable without artifact coupling
- Better fit for hot-path job views and summaries

**Cons:**

- Requires CMS schema change and GraphQL regeneration
- Higher implementation scope than the immediate bug

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 3: UI-only fallback from materialization metadata

**Approach:** Leave the job API/read model unchanged, but teach the jobs UI to derive and display source-language fields from `artifacts.materialization`.

**Pros:**

- Minimal API change
- Restores operator visibility in the UI quickly

**Cons:**

- Does not fix the API contract
- Other consumers of `/api/jobs/:id` still see incomplete data
- Spreads derivation logic into presentation code

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

Prefer **Option 1** first: populate source-language/source-selection fields in the read model from `artifacts.materialization.data`, then evaluate whether a later cleanup should promote those fields into first-class CMS schema.

That fixes the operator/API visibility bug quickly without broadening the current enrichment scope into a schema migration.

## Technical Details

**Affected files:**

- [apps/manager/src/app/api/enrich/route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/enrich/route.ts)
  - source-selection truth is already persisted here
- [apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts)
  - missing source-language fields on `JobRecord`
- [apps/manager/src/lib/state.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/state.ts)
  - `toJobRecord(...)` likely needs to derive/map these fields
- [apps/manager/src/app/api/jobs/[id]/route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/jobs/[id]/route.ts)
  - returns the read model directly
- [apps/manager/src/app/dashboard/jobs/[id]/page.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/[id]/page.tsx)
  - likely consumer if UI changes are needed
- [apps/manager/src/features/jobs/live-job-detail-header.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-detail-header.tsx)
  - likely consumer if source metadata should be surfaced visually

**Database changes:**

- Migration needed? No for Option 1 / Option 3
- Migration needed? Yes for Option 2

## Resources

- **QA jobs:**
  - `qsix8zfjtyyzw5ah5r4zfb27`
  - `suxvaak4p4v0p4bnmvbde8d7`
- **Related work:**
  - [docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md](/Users/o/.codex/worktrees/1ec2/forge/docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md)
  - [docs/plans/2026-04-04-feat-source-language-priority-for-enrichment-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-04-feat-source-language-priority-for-enrichment-plan.md)

## Acceptance Criteria

- [x] `/api/jobs/:id` exposes the effective source-language data needed for QA
- [x] A completed fallback job like `suxvaak4p4v0p4bnmvbde8d7` no longer reports `sourceLanguageCode: null`
- [x] The exposed read model can distinguish requested target language from actual chosen source language
- [x] Automated coverage exists for the read-model mapping or derivation logic
- [x] No existing job artifact links or materialization metadata regress

## Work Log

### 2026-04-09 - Initial Discovery

**By:** Codex

**Actions:**

- Ran a full local dev-server QA flow for an English-targeted enrich job
- Ran a full local dev-server QA flow for a Russian-targeted enrich job
- Verified that the Russian job completed with a real English-to-Russian translation artifact
- Compared the top-level `/api/jobs/:id` response against `artifacts.materialization.data`
- Identified that the read model drops source-language/source-selection fields that are already persisted

**Learnings:**

- The persisted materialization metadata is truthful
- The drift is in job read-model/API serialization, not in the enrich execution itself
- This is operator-visible because fallback source selection is now an important QA behavior

### 2026-04-09 - Read-model fix shipped

**By:** Codex

**Actions:**

- Added additive source-language/source-selection fields to `JobRecord`
- Derived those fields from `artifacts.materialization.data` inside `toJobRecord(...)`
- Added regression coverage for both object and legacy stringified materialization payloads
- Revalidated the live Russian fallback job `suxvaak4p4v0p4bnmvbde8d7` through `/api/jobs/:id`

**Verification:**

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- Live API QA:
  - `sourceLanguageCode: "en"`
  - `sourceLanguageId: "529"`
  - `sourceSelectionReason: "fallback-en"`
  - `resolvedTargetLanguageCodes: ["ru"]`

**Learnings:**

- Deriving the read-model fields from normalized materialization metadata fixes the operator-visible API gap without a CMS schema change
- The materialization artifact remains the single source of truth, and the top-level job payload is now aligned with it

## Notes

- Severity is `p2` because enrichment still works and artifacts are correct, but the API/UI contract is incomplete and can mislead QA.
