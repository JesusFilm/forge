---
status: pending
priority: p2
issue_id: "019"
tags: [manager, cms, jobs, cleanup]
dependencies: []
---

# Remove legacy CMS notify UI and step

## Problem Statement

The branch still exposes legacy CMS notification concepts that are not part of the live enrichment flow:

- a `cms_notify` workflow step name in manager job types and UI copy
- a `Notify CMS (Strapi)` checkbox in the old manual job form

These imply that enrichment results are actively pushed back into Strapi CMS as a downstream completion step, but that is not how the current branch works. The durable job record is stored in Strapi, while generated artifacts are stored in Forge-managed artifact storage. Leaving these stale affordances in place creates confusion about actual product behavior and makes later CMS write-back planning harder because the UI already appears to promise something we do not do.

## Findings

- [types/job.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts) still includes `cms_notify` in `WorkflowStepName` and `notifyCms` in `JobOptions`.
- [live-job-steps-table.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx) still renders the step description `Notifies downstream CMS integrations of completion.`
- [new-job-form.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/new-job-form.tsx) still shows a `Notify CMS (Strapi)` checkbox and posts `options.notifyCms`.
- `rg` over `apps/manager/src` found no live implementation path that actually performs a CMS notification step. The only remaining references are the type name, old form state, and step-table copy.
- [strapi-enrichment-job-content-type.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/cms/strapi-enrichment-job-content-type.md) confirms the actual pattern: Strapi stores durable job state, not all enrichment outputs as downstream-notified content.

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

**To be filled during triage.** Preferred direction is Option 1: remove both the stale workflow name and the old form checkbox, then update any affected tests/docs so the manager UI only reflects real supported flows.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/types/job.ts)
- [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/features/jobs/live-job-steps-table.tsx)
- [/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/new-job-form.tsx](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/dashboard/jobs/new-job-form.tsx)

**Related components:**

- job detail step rendering
- legacy manual job creation UI
- any manager tests that assert the full workflow step vocabulary

**Database changes (if any):**

- Migration needed? No
- New columns/tables? No

## Resources

- **Solution doc:** [/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/cms/strapi-enrichment-job-content-type.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/cms/strapi-enrichment-job-content-type.md)
- **Related plan:** [/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md)

## Acceptance Criteria

- [ ] `cms_notify` is removed from the active manager workflow vocabulary unless a real implementation exists in the same change.
- [ ] `notifyCms` is removed from the old manual job form and request payload.
- [ ] Step-table copy no longer claims a downstream CMS notification step that does not exist.
- [ ] Any affected manager tests are updated and pass.
- [ ] Manager UI remains truthful about what is stored in Strapi versus artifact storage.

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

## Notes

- If future work adds real CMS write-back, it should return as a newly planned feature with explicit behavior and audit trails rather than reusing stale dormant affordances by accident.
