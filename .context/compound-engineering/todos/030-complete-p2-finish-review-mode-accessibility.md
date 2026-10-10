---
status: complete
priority: p2
issue_id: "030"
tags: [code-review, accessibility, manager, review-player]
dependencies: []
---

# Finish Review Mode Accessibility

## Problem Statement

The Before / After switch is implemented with `role="tablist"` and `role="tab"`, but it does not complete the ARIA tab pattern with tab panels, `aria-controls`, or arrow-key navigation. This can make the control less reliable for assistive technology and browser agents.

## Findings

- `apps/manager/src/features/jobs/review-player/review-player-card.tsx:300` renders a `role="tablist"`.
- `apps/manager/src/features/jobs/review-player/review-player-card.tsx:309` renders each option as `role="tab"` with `aria-selected`, but there is no linked `tabpanel`.
- The UI is semantically closer to a two-state toggle than a multi-panel tab interface.

## Proposed Solutions

### Option 1: Use Toggle Buttons

**Approach:** Replace tab roles with plain buttons using `aria-pressed` to indicate the selected review mode.

**Pros:**

- Simpler markup.
- Matches the actual interaction.

**Cons:**

- Loses tab semantics if the team wants a full tab pattern later.

**Effort:** 30-60 minutes

**Risk:** Low

### Option 2: Complete the ARIA Tab Pattern

**Approach:** Add `aria-controls`, `id`, a `tabpanel`, and arrow-key handling.

**Pros:**

- Correct if this should remain a tabbed interface.

**Cons:**

- More code for a small two-state comparison.

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

Completed Option 1: simplified the Before / After switch to toggle buttons with `aria-pressed`.

## Technical Details

**Affected files:**

- `apps/manager/src/features/jobs/review-player/review-player-card.tsx`
- `apps/manager/src/app/globals.css`

## Resources

- Review finding from agent-native/accessibility review on 2026-04-12.

## Acceptance Criteria

- [x] Review mode switch exposes correct semantics for assistive tech.
- [x] Keyboard users can reliably switch modes.
- [x] Browser smoke or component test verifies the default and switched states.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Reviewed `ReviewPlayerCard` mode control markup.
- Confirmed the current implementation uses partial tab semantics without tab panels.

**Learnings:**

- For small two-state UI controls, simple button semantics are often more robust than partial ARIA patterns.

### 2026-04-12 - Review Fix

**By:** Codex

**Actions:**

- Replaced incomplete tab semantics with a labeled button group using `aria-pressed`.
- Kept the default selection on After and preserved the existing click interaction.
- Verified the semantics with a browser smoke that checked no tab roles remain and Before/After toggling updates pressed state.

**Learnings:**

- When an interface is a two-state switch, native buttons with explicit pressed state are easier to maintain than a partial tabs pattern.
