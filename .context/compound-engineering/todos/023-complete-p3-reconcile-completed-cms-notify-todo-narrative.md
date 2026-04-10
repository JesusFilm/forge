---
status: complete
priority: p3
issue_id: "023"
tags: [code-review, todos, documentation, quality]
dependencies: []
---

# Reconcile completed cms_notify todo narrative

## Problem Statement

The completed cleanup todo for `cms_notify` is internally inconsistent.

Its status and acceptance criteria say the work is complete, but the earlier Findings section still speaks in present tense as if `cms_notify` and `notifyCms` are still in the codebase. That makes the durable artifact confusing to read later and weakens confidence in the todo history.

## Findings

- [019-complete-p2-remove-legacy-cms-notify-ui-and-step.md:2](/Users/o/.codex/worktrees/9f1b/forge/.context/compound-engineering/todos/019-complete-p2-remove-legacy-cms-notify-ui-and-step.md#L2) marks the todo `status: complete`.
- [019-complete-p2-remove-legacy-cms-notify-ui-and-step.md:128](/Users/o/.codex/worktrees/9f1b/forge/.context/compound-engineering/todos/019-complete-p2-remove-legacy-cms-notify-ui-and-step.md#L128) shows all acceptance criteria checked off.
- Earlier sections such as the Findings block still describe `cms_notify` and `notifyCms` as currently present, without framing that text as pre-fix discovery context.
- This surfaced during review as a documentation consistency issue in the durable todo artifact.

## Proposed Solutions

### Option 1: Reframe the existing findings as baseline discovery

**Approach:** Keep the historical findings, but explicitly label them as pre-fix state and add a short current-state summary after implementation.

**Pros:**

- Preserves the investigative history
- Makes the completed todo internally consistent
- Best fit for a durable work log artifact

**Cons:**

- Slightly more editing than a simple wording pass

**Effort:** Under 30 minutes

**Risk:** Low

---

### Option 2: Rewrite the Findings section into past tense

**Approach:** Convert the present-tense statements into "before this fix" wording without adding a separate current-state summary.

**Pros:**

- Very small edit
- Resolves the direct contradiction

**Cons:**

- Leaves less explicit separation between baseline and completed state

**Effort:** Under 15 minutes

**Risk:** Low

## Recommended Action

Reframe the completed `cms_notify` cleanup todo so it clearly distinguishes pre-fix baseline findings from the current completed state, while preserving the investigation history.

## Technical Details

**Affected files:**

- [/Users/o/.codex/worktrees/9f1b/forge/.context/compound-engineering/todos/019-complete-p2-remove-legacy-cms-notify-ui-and-step.md](/Users/o/.codex/worktrees/9f1b/forge/.context/compound-engineering/todos/019-complete-p2-remove-legacy-cms-notify-ui-and-step.md)

**Related components:**

- durable file-based todo history
- review artifact readability

**Database changes (if any):**

- Migration needed? No
- New columns/tables? No

## Resources

- **Related review scope:** current uncommitted `cms_notify` cleanup diff in `/Users/o/.codex/worktrees/9f1b/forge`

## Acceptance Criteria

- [x] The completed todo clearly distinguishes pre-fix findings from current state.
- [x] Readers can understand why the todo is complete without reading contradictory present-tense statements.
- [x] Historical investigation detail is preserved or intentionally simplified.

## Work Log

### 2026-04-10 - Review Finding Created

**By:** Codex

**Actions:**

- Reviewed the completed `cms_notify` cleanup todo as part of a multi-agent code review
- Identified internal inconsistency between the todo status and the narrative sections
- Captured the documentation issue as a durable review todo

**Learnings:**

- Completed todos benefit from a short current-state framing, especially when they preserve pre-fix findings
- Review quality applies to process artifacts too, not just runtime code

### 2026-04-10 - Implementation Complete

**By:** Codex

**Actions:**

- Reframed the completed `cms_notify` cleanup todo as baseline discovery rather than current state
- Added a short current-state summary so the artifact now matches its `complete` status and checked acceptance criteria
- Kept the historical investigation details intact for future readers

**Learnings:**

- Completed durable todos read much better when they separate baseline findings from post-fix state explicitly

## Notes

- This is a P3 documentation/readability issue in the durable artifact, not a product behavior problem.
