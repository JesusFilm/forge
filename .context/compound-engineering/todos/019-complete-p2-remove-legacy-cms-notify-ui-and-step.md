---
status: complete
priority: p2
issue_id: "019"
tags: [manager, cms, jobs, cleanup]
dependencies: []
---

# Remove legacy CMS notify UI and step

## Problem Statement

Before this cleanup, the branch still exposed legacy CMS notification concepts that were not part of the live enrichment flow:

- a `cms_notify` workflow step name in manager job types and UI copy
- a `Notify CMS (Strapi)` checkbox in the old manual job form

These implied that enrichment results were actively pushed back into Strapi CMS as a downstream completion step, but that is not how the current branch works. The durable job record is stored in Strapi, while generated artifacts are stored in Forge-managed artifact storage. Leaving those stale affordances in place created confusion about actual product behavior and made later CMS write-back planning harder because the UI already appeared to promise something we do not do.

This cleanup also needed to distinguish between stale runtime code and forward-looking planning language. `cms_notify` was dead manager vocabulary. `cms_sync` appeared as planned terminology in docs, but it could not be removed from code unless a fresh audit confirmed it was only documentary and not part of a live execution path.

Current state:

- `cms_notify` and `notifyCms` have been removed from manager runtime code.
- `cms_sync` remains only in planning docs for future CMS write-back work.

## Findings

- Baseline discovery: [types/job.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/types/job.ts) included `cms_notify` in `WorkflowStepName` and `notifyCms` in `JobOptions`.
- Baseline discovery: [live-job-steps-table.tsx](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx) rendered the step description `Notifies downstream CMS integrations of completion.`
- Baseline discovery: [new-job-form.tsx](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/app/dashboard/jobs/new-job-form.tsx) showed a `Notify CMS (Strapi)` checkbox and posted `options.notifyCms`.
- Baseline discovery: `rg` over `apps/manager/src` found no live implementation path that actually performed a CMS notification step. The only remaining references were the type name, old form state, and step-table copy.
- Baseline discovery: [app/api/jobs/route.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/app/api/jobs/route.ts) did not accept `notifyCms`, which confirmed the checkbox was disconnected from the live jobs API contract.
- Baseline discovery: [workflow-steps.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/lib/workflow-steps.ts) and [videoEnrichment.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/workflows/videoEnrichment.ts) only created and ran `transcription`, `translation`, `chapters`, `metadata`, and `embeddings`.
- Baseline discovery: `rg` over manager, CMS, packages, roadmap, and plans found no runtime `cms_sync` implementation. `cms_sync` references were limited to planning docs for future CMS write-back work.
- [strapi-enrichment-job-content-type.md](/Users/o/.codex/worktrees/9f1b/forge/docs/solutions/cms/strapi-enrichment-job-content-type.md) confirms the actual pattern: Strapi stores durable job state, not all enrichment outputs as downstream-notified content.

## Proposed Solutions

### Option 1: Remove the stale step and checkbox entirely

**Approach:** Delete `cms_notify` and `notifyCms` from manager types and old form UI, and refresh any related copy/tests.

**Pros:**

- Aligns code and UI with current branch reality
- Reduces product confusion before any real CMS write-back feature exists
- Makes future CMS sync work start from a truthful baseline

**Cons:**

- Slightly narrows compatibility with older upstream VideoForge vocabulary
- May require updating snapshot tests or historical assumptions in docs

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Keep the vocabulary but hide the UI affordance

**Approach:** Remove the checkbox from the old form, but keep `cms_notify` in step/type unions as dormant compatibility scaffolding.

**Pros:**

- Smaller surface change
- Retains upstream vocabulary if needed later

**Cons:**

- Leaves misleading dead code and step descriptions in place
- Does not fully resolve the conceptual drift

**Effort:** Under 1 hour

**Risk:** Low

---

### Option 3: Keep both and document them as future-facing

**Approach:** Leave the checkbox and step name, but add explanatory copy/docs that the path is not currently wired.

**Pros:**

- Minimal code churn
- Preserves possible future intent

**Cons:**

- Continues to expose inaccurate UX
- Increases operator confusion
- Harder to distinguish real CMS sync work later

**Effort:** 1 hour

**Risk:** Medium

## Recommended Action

Remove the stale `cms_notify` runtime vocabulary from manager now: delete the dead checkbox, request payload field, type union member, and step-table copy, then update any affected tests. Do not remove planning-doc references to `cms_sync`; instead, verify again during implementation that `cms_sync` still has no runtime callers and only remove code-level traces that are actually unused.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/types/job.ts)
- [/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/app/dashboard/jobs/new-job-form.tsx](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/app/dashboard/jobs/new-job-form.tsx)
- [/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/app/api/jobs/route.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/app/api/jobs/route.ts)
- [/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/lib/workflow-steps.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/lib/workflow-steps.ts)
- [/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/workflows/videoEnrichment.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/workflows/videoEnrichment.ts)

**Related components:**

- job detail step rendering
- legacy manual job creation UI
- any manager tests that assert the full workflow step vocabulary

**Database changes (if any):**

- Migration needed? No
- New columns/tables? No

## Resources

- **Solution doc:** [/Users/o/.codex/worktrees/9f1b/forge/docs/solutions/cms/strapi-enrichment-job-content-type.md](/Users/o/.codex/worktrees/9f1b/forge/docs/solutions/cms/strapi-enrichment-job-content-type.md)
- **Related plan:** [/Users/o/.codex/worktrees/9f1b/forge/docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md](/Users/o/.codex/worktrees/9f1b/forge/docs/plans/2026-04-09-feat-sync-enrichment-results-into-cms-models-plan.md)

## Acceptance Criteria

- [x] `cms_notify` is removed from the active manager workflow vocabulary unless a real implementation exists in the same change.
- [x] `notifyCms` is removed from the old manual job form and request payload.
- [x] Step-table copy no longer claims a downstream CMS notification step that does not exist.
- [x] A fresh search confirms there is still no runtime `cms_sync` implementation before removing any similarly named code.
- [x] Any affected manager tests are updated and pass.
- [x] Manager UI remains truthful about what is stored in Strapi versus artifact storage.

## Work Log

### 2026-04-09 - Initial Discovery

**By:** Codex

**Actions:**

- Audited manager and CMS code paths for `cms_notify` and `notifyCms`
- Confirmed remaining references are stale type/UI affordances only
- Verified current branch behavior stores durable job state in Strapi and artifacts outside Strapi
- Drafted cleanup options and acceptance criteria

**Learnings:**

- The old manual job form still exposes upstream VideoForge-era options that are not part of the live enrich flow
- This cleanup is mostly a truthfulness/UX alignment task, not a behavior migration

### 2026-04-10 - Scope Refresh

**By:** Codex

**Actions:**

- Re-audited manager runtime code, workflow setup, and jobs API for `cms_notify`, `notifyCms`, and `cms_sync`
- Confirmed `notifyCms` is not accepted by the live jobs API
- Confirmed the executed workflow still only runs transcription, translation, chapters, metadata, and embeddings
- Confirmed `cms_sync` currently appears only in planning docs, not in runtime code
- Promoted this todo to `ready` based on explicit user approval to perform the cleanup

**Learnings:**

- `cms_notify` is dead runtime vocabulary and safe cleanup territory once tests are updated
- `cms_sync` is currently a future-facing planning term, so documentary references should not be removed as part of code cleanup unless the related plan is intentionally being revised

### 2026-04-10 - Implementation Complete

**By:** Codex

**Actions:**

- Removed the unused legacy manager job form file that still posted `notifyCms`
- Removed `cms_notify` from the manager workflow step union and job-step UI copy
- Verified no runtime `cms_notify`, `notifyCms`, `cms_sync`, or `content_sync` references remain under manager, CMS, or packages
- Installed workspace dependencies with `pnpm install --frozen-lockfile` so validation could run in this worktree
- Ran `pnpm --filter @forge/manager typecheck`
- Ran `pnpm --filter @forge/manager lint`
- Ran `pnpm --filter @forge/manager test`

**Learnings:**

- The only remaining `cms_sync` references are plan-level documentation for future CMS write-back work
- The legacy manual job form was fully unused in the current manager app, so deleting it was lower risk than trying to preserve a stale incompatible API shape

## Notes

- If future work adds real CMS write-back, it should return as a newly planned feature with explicit behavior and audit trails rather than reusing stale dormant affordances by accident.
