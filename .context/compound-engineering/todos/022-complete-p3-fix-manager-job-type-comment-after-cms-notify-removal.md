---
status: complete
priority: p3
issue_id: "022"
tags: [code-review, manager, typescript, quality]
dependencies: []
---

# Fix manager job type comment after cms_notify removal

## Problem Statement

The header comment in `apps/manager/src/types/job.ts` no longer matches the code beneath it after the `cms_notify` cleanup.

It still says the job types were copied "verbatim" from the original VideoForge repo and that "the full union is kept," but this branch now intentionally removes `cms_notify` and `notifyCms`. Leaving that provenance comment stale makes this core type file less trustworthy and can mislead future maintainers about which compatibility constraints are still real.

## Findings

- [apps/manager/src/types/job.ts:1](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/types/job.ts#L1) still says the types were copied "verbatim" and that "the full union is kept."
- The same file now omits `cms_notify` from `WorkflowStepName` and removes `notifyCms` from `JobOptions`, so the comment overstates current compatibility.
- This came up during multi-agent review of the `cms_notify` cleanup as a documentation/trustworthiness issue rather than a runtime bug.

## Proposed Solutions

### Option 1: Rewrite the header comment to describe current reality

**Approach:** Update the comment to say the file started from upstream VideoForge types but now preserves only the compatibility vocabulary still intentionally supported in Forge.

**Pros:**

- Makes the file self-consistent
- Low effort, low risk
- Helps future maintainers understand intentional divergence

**Cons:**

- Requires deciding how much historical detail belongs in a source comment

**Effort:** Under 30 minutes

**Risk:** Low

---

### Option 2: Remove the provenance comment entirely

**Approach:** Delete the misleading header comment instead of maintaining historical context inline.

**Pros:**

- Eliminates drift risk
- Keeps the type file terse

**Cons:**

- Loses useful origin/context for future cleanup work

**Effort:** Under 15 minutes

**Risk:** Low

## Recommended Action

Rewrite the header comment in `apps/manager/src/types/job.ts` so it describes the current Forge compatibility surface instead of claiming verbatim parity with upstream VideoForge.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/types/job.ts](/Users/o/.codex/worktrees/9f1b/forge/apps/manager/src/types/job.ts)

**Related components:**

- manager job read model types
- workflow-step compatibility vocabulary

**Database changes (if any):**

- Migration needed? No
- New columns/tables? No

## Resources

- **Related cleanup todo:** [/Users/o/.codex/worktrees/9f1b/forge/.context/compound-engineering/todos/019-complete-p2-remove-legacy-cms-notify-ui-and-step.md](/Users/o/.codex/worktrees/9f1b/forge/.context/compound-engineering/todos/019-complete-p2-remove-legacy-cms-notify-ui-and-step.md)

## Acceptance Criteria

- [x] The header comment in `apps/manager/src/types/job.ts` no longer claims the types are copied verbatim if they are not.
- [x] The comment accurately describes the intentional compatibility surface that remains in Forge.
- [x] No behavior or type signatures change as part of the comment-only cleanup.

## Work Log

### 2026-04-10 - Review Finding Created

**By:** Codex

**Actions:**

- Reviewed the `cms_notify` cleanup diff with parallel review agents
- Identified a stale provenance comment in `apps/manager/src/types/job.ts`
- Captured the issue as a durable review todo

**Learnings:**

- Small cleanup diffs can still leave behind misleading historical comments
- Source comments in shared type files need the same maintenance bar as the code they describe

### 2026-04-10 - Implementation Complete

**By:** Codex

**Actions:**

- Updated the `apps/manager/src/types/job.ts` header comment to describe the adapted Forge type surface instead of claiming verbatim upstream parity
- Kept the change comment-only with no type or behavior changes
- Re-ran manager validation alongside the related documentation cleanup

**Learnings:**

- A short provenance comment is still useful here, but it needs to describe intentional divergence explicitly

## Notes

- This is a P3 trustworthiness/documentation issue, not a runtime regression.
