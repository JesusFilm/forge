---
status: ready
priority: p2
issue_id: "026"
tags: [manager, agents, ui]
dependencies: []
---

# Show Agent Details In Modal

## Problem Statement

The Agents list currently displays automation details directly inside each row/card: refresh mode, target languages, next run, last result, run history, and pause/resume controls. This makes the list visually dense and pushes detail content into the browse surface.

Agent/automation details should appear in a popup modal instead. The list should stay compact and let operators open a modal when they want to inspect details or run history.

## Findings

- Agent list rendering lives in `apps/manager/src/features/agents/automation-list.tsx`.
- Each automation row currently renders `agents-detail-grid`, `AutomationRunHistory`, and row actions inline.
- The create flow already introduced modal styling and behavior in `apps/manager/src/features/agents/agents-page.tsx` and `apps/manager/src/app/globals.css`.
- A details modal can likely reuse the same modal shell patterns as the new automation modal while keeping list rows as compact summaries.
- The attached review screenshot highlights the current inline detail grid on the automation card.

## Proposed Solutions

### Option 1: Add A Dedicated Automation Details Modal

**Approach:** Make each automation row open a dedicated details modal containing the full detail grid, run history, and status actions. Keep the card summary compact with name, template/schedule/cap, status badge, and a clear “Details” action.

**Pros:**

- Clear separation between browse and inspect modes.
- Reuses existing modal styling patterns.
- Keeps all current details available without crowding the list.

**Cons:**

- Requires state management for selected automation.
- Needs careful keyboard/escape/backdrop handling and browser smoke coverage.

**Effort:** 2-4 hours

**Risk:** Low / Medium

---

### Option 2: Use Expandable Rows Instead

**Approach:** Collapse details by default and expand them inline when clicked.

**Pros:**

- Smaller change than a modal.
- Keeps context near the row.

**Cons:**

- Does not satisfy the requested popup modal behavior.
- The list can still become visually noisy when expanded.

**Effort:** 1-2 hours

**Risk:** Medium

---

### Option 3: Move Only Run History Into A Modal

**Approach:** Keep the detail grid inline but move run history into a popup modal.

**Pros:**

- Reduces some vertical weight.

**Cons:**

- Does not fully satisfy “agent details should appear in popup modal.”
- Leaves the main list denser than requested.

**Effort:** 1-2 hours

**Risk:** Medium

## Recommended Action

Implement Option 1. Add a dedicated agent/automation details modal opened from each list row, move the full details and run history into the modal, and leave the list row as a compact summary with status and a Details action.

## Technical Details

**Affected files:**

- `apps/manager/src/features/agents/automation-list.tsx`
- `apps/manager/src/features/agents/automation-run-history.tsx`
- `apps/manager/src/features/agents/agents-page.tsx` if modal state is lifted
- `apps/manager/src/app/globals.css`

**Related components:**

- `AutomationRunHistory` should remain reusable inside the modal.
- Existing create modal patterns can inform backdrop, close, escape, and responsive behavior.

**Database changes:**

- No database changes expected.

## Resources

- Current inline list: `apps/manager/src/features/agents/automation-list.tsx`
- Existing modal styling: `apps/manager/src/app/globals.css`
- User request screenshot: inline automation card detail grid showing refresh, target languages, next run, and last result.

## Acceptance Criteria

- [ ] Agent/automation details are shown in a popup modal rather than inline in the list row.
- [ ] The list row remains compact and includes a clear way to open the details modal.
- [ ] The details modal includes refresh mode, target languages, next run, last result, run history, and pause/resume action.
- [ ] The details modal supports close button, Escape key, and backdrop close behavior.
- [ ] Keyboard focus and accessible dialog labels are handled reasonably.
- [ ] User-like browser smoke proves opening and closing the details modal from `/dashboard/agents`, with screenshot or equivalent validation.
- [ ] `pnpm --filter @forge/manager test -- src/features/agents` passes.
- [ ] `pnpm --filter @forge/manager typecheck`, `pnpm format:check`, and relevant lint/test checks pass.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Captured the follow-up requirement that agent details should appear in a popup modal.
- Reviewed the current `AutomationList` implementation and found details and run history rendered inline per automation row.
- Noted that existing create-modal patterns can be reused for the details modal.

**Learnings:**

- This is a UI structure change, not a data-model change.
- The main implementation risk is keeping modal interactions accessible while preserving pause/resume behavior.

## Notes

- Consider whether clicking the row itself should open details or whether a dedicated Details button is clearer.
- Keep status-changing actions from accidentally firing when an operator only intends to inspect details.
