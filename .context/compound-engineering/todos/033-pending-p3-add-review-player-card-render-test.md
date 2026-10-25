---
status: pending
priority: p3
issue_id: "033"
tags: [code-review, testing, manager, review-player]
dependencies: []
---

# Add Review Player Card Render Test

## Problem Statement

The review player has unit coverage for data shaping and presentation helpers, but no component-level render test for the JSX branch that shows Before / After tabs and the full metadata panel. A JSX regression could hide Collections, Source media, or other fields without failing tests.

## Findings

- `apps/manager/src/features/jobs/review-player/review-player-metadata.test.ts` covers the display-field builder.
- `apps/manager/src/features/jobs/review-player/review-player-presenter.test.ts` covers state derivation.
- `apps/manager/src/features/jobs/review-player/review-player-card.tsx` itself is not rendered by a test, so tab order/default selection and metadata visibility are currently covered only by browser smoke.

## Proposed Solutions

### Option 1: Add a Lightweight Component Render Test

**Approach:** Configure or use a React DOM test for `ReviewPlayerCard` with a mocked `@forge/video-player` hook and assert tab order plus metadata labels.

**Pros:**

- Catches JSX regressions cheaply.
- Complements browser smoke.

**Cons:**

- Manager Vitest currently uses a node environment, so component tests may need a local jsdom config or colocated setup.

**Effort:** 1-2 hours

**Risk:** Medium

### Option 2: Expand Browser Smoke Coverage Only

**Approach:** Keep the current unit tests and maintain a scripted Playwright smoke for this page.

**Pros:**

- Tests the actual app integration.

**Cons:**

- Slower and more environment-dependent.
- Easier to skip locally.

**Effort:** 1 hour

**Risk:** Medium

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**

- `apps/manager/src/features/jobs/review-player/review-player-card.tsx`
- `apps/manager/src/features/jobs/review-player/review-player-card.test.tsx` or equivalent
- `apps/manager/vitest.config.ts`

## Resources

- Review finding from TypeScript/testing review on 2026-04-12.

## Acceptance Criteria

- [ ] Test renders a ready review context.
- [ ] Test asserts `Before / After` order and default selected state.
- [ ] Test asserts Title, Description, Language, Collections, Source media, Topics, Speakers, and Tags labels are visible.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Reviewed existing review-player test coverage.
- Confirmed field builder and presenter are covered but JSX rendering is not.

**Learnings:**

- Browser smoke proves integration, but component render tests provide cheaper regression coverage for label-level UI requirements.
