---
status: pending
priority: p3
issue_id: "034"
tags: [code-review, manager, metadata, review-player]
dependencies: []
---

# Render Collection Titles As Discrete Values

## Problem Statement

Multiple CMS parent titles are flattened into one comma-separated `sourceCollectionTitle` string before rendering. The review player can show a Collections label, but it cannot faithfully render or test each collection as a discrete metadata value.

## Findings

- `apps/manager/src/lib/state.ts:337` joins parent titles with `", "`.
- `apps/manager/src/features/jobs/review-player/review-player-metadata.ts:52` renders Collections as a text field rather than a list.
- This is adequate for a single collection but ambiguous when a video has multiple parents or collection titles containing commas.

## Proposed Solutions

### Option 1: Add `sourceCollectionTitles` to `JobRecord`

**Approach:** Preserve parent titles as an array and render them as chips in the review metadata panel.

**Pros:**

- Faithfully represents multiple collections.
- Matches topics/tags/speakers rendering.

**Cons:**

- Requires updating read-model types and tests.

**Effort:** 1-2 hours

**Risk:** Low

### Option 2: Keep String Field and Split Only for Display

**Approach:** Split `sourceCollectionTitle` in the review metadata helper.

**Pros:**

- Smaller change.

**Cons:**

- Cannot safely distinguish real comma punctuation from separators.

**Effort:** 30 minutes

**Risk:** Medium

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**

- `apps/manager/src/types/job.ts`
- `apps/manager/src/lib/state.ts`
- `apps/manager/src/features/jobs/review-player/review-player-metadata.ts`
- `apps/manager/src/features/jobs/review-player/review-player-metadata.test.ts`

## Resources

- Review finding from agent-native/simplification review on 2026-04-12.

## Acceptance Criteria

- [ ] Multiple collections render as discrete values.
- [ ] Existing single-collection/table behavior remains intact.
- [ ] Tests cover multiple parent collection titles.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Reviewed `toJobRecord()` parent-title mapping and review metadata rendering.
- Confirmed collections are collapsed into one string before display.

**Learnings:**

- Values that are semantically lists should stay arrays in the read model until the UI decides how to present them.
