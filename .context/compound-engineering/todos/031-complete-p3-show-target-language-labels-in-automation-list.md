---
status: complete
priority: p3
issue_id: "031"
tags: [code-review, manager, ui, automations]
dependencies: []
---

# Show Target Language Labels In Automation List

## Problem Statement

The saved automation list renders target language IDs directly. After a user creates a target subtitle automation, the dashboard does not show a readable language label for verifying which language was selected.

## Findings

- `apps/manager/src/features/agents/automation-list.tsx` formats `targetLanguageIds` by joining raw core IDs.
- The create modal has access to readable language names, but the list view only displays persisted IDs.
- This is user-facing polish and does not block the ownership-safety fix.

## Proposed Solutions

### Option 1: Pass Language Labels Into AutomationList

**Approach:** Build a `coreId -> name` map in `AgentsPage` from the loaded language options and use it to format target language summaries.

**Pros:**

- Small, local UI improvement.
- Reuses data the page already loads.

**Cons:**

- Needs fallback handling for unknown language IDs.

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Persist/Fetch Language Relation Data

**Approach:** Model target languages as relations or fetch label metadata alongside automations.

**Pros:**

- More durable data model.

**Cons:**

- Larger CMS/GraphQL change than needed for the current UI.

**Effort:** 1 day

**Risk:** Medium

## Recommended Action

Implemented Option 1: pass the loaded language label map into the automation list and preserve an ID fallback for unknown languages.

## Technical Details

Affected files:

- `apps/manager/src/features/agents/automation-list.tsx`
- `apps/manager/src/features/agents/agents-page.tsx`
- Potentially `apps/manager/src/app/dashboard/agents/page.tsx`

## Resources

- Review finding from workflows-review on 2026-04-12.

## Acceptance Criteria

- [x] Target subtitle automation cards show readable language names when available.
- [x] Unknown IDs fall back gracefully without crashing.
- [x] User-like browser smoke verifies the saved list after creation.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Captured workflows-review UI finding that automation cards display raw core IDs.

**Learnings:**

- The list should use the same human-readable language metadata already available to the create flow.

### 2026-04-12 - Implemented

**By:** Codex

**Actions:**

- Added automation-list presenter formatting for language labels with raw-ID fallback.
- Passed the Agents page language-name map into active and paused automation lists.
- Added presenter tests for label and fallback behavior.
- Verified with a browser smoke that created `Review work target subtitles label` and confirmed the saved card rendered `Ελληνικά`; screenshot: `output/playwright/workflows-work-agents-language-label-smoke-20260412.png`.

**Learnings:**

- Reusing the loaded language options keeps the list readable without expanding the CMS automation shape.
