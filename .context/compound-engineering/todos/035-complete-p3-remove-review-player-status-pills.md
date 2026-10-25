---
status: complete
priority: p3
issue_id: "035"
tags: [manager, ui, review-player, subtitles]
dependencies: []
---

# Remove Review Player Status Pills

## Problem Statement

The Review Player card shows redundant status pills above the video player:
`Live state` / `Generated output` and the current subtitle track label such as
`EN subtitles`. The screenshot feedback asks to remove those elements so the
player surface is cleaner and the Before / After switch remains the primary
mode indicator.

## Findings

- `apps/manager/src/features/jobs/review-player/review-player-card.tsx:338` renders `.jobs-review-player-meta` immediately above `ReviewVideoPlayer`.
- The first pill duplicates the selected review mode already shown by the `Before` / `After` control.
- The second pill renders `{state.player.track.label} subtitles`, which produces labels like `EN subtitles`.
- Related roadmap item `docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md` is complete, so this should be handled as a focused UI cleanup rather than broadening the original feature scope.

## Proposed Solutions

### Option 1: Remove The Player Meta Pill Row

**Approach:** Delete the `.jobs-review-player-meta` block and any now-unused styles if they are not referenced elsewhere.

**Pros:**

- Directly satisfies the requested cleanup.
- Removes redundant copy without changing review mode or language selection behavior.
- Small, low-risk UI change.

**Cons:**

- If operators relied on the subtitle pill as a quick track confirmation, they will need to use the existing language selector/player track surface instead.

**Effort:** 15-30 minutes

**Risk:** Low

---

### Option 2: Keep Track Information Only For Assistive Context

**Approach:** Remove the visible pills but retain concise non-visual context if testing shows the current player/selector does not expose selected track state clearly enough.

**Pros:**

- Keeps the visual surface clean while preserving context if needed.

**Cons:**

- May be unnecessary because the language selector already communicates the chosen language.

**Effort:** 30-45 minutes

**Risk:** Low

## Recommended Action

Remove the visible Review Player status pill row from the player shell and
delete the now-unused pill CSS selectors. Preserve the existing Before / After
buttons, language selector, player controls, and empty-track messaging.

## Technical Details

**Affected files:**

- `apps/manager/src/features/jobs/review-player/review-player-card.tsx`
- `apps/manager/src/app/globals.css`

**Related components:**

- `ReviewVideoPlayer`
- `ReviewPlayerCard`

**Database changes (if any):**

- None.

## Resources

- Screenshot feedback from 2026-04-12: remove `Live state: EN subtitles` and `Generated output: EN subtitles` elements.
- Related roadmap ticket: `docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md`
- Adjacent solution note: `docs/solutions/ui-bugs/manager-review-player-before-after-toggle-buttons-2026-04-12.md`

## Acceptance Criteria

- [x] Review Player no longer shows the `Live state` / `Generated output` pill above the player.
- [x] Review Player no longer shows the current track pill such as `EN subtitles` above the player.
- [x] `Before` / `After` mode switching still changes the review state and player content.
- [x] Language selection still works when multiple subtitle tracks are available.
- [x] Unused CSS for the removed pill row is deleted or confirmed still needed.
- [x] Manager lint/typecheck or the narrow relevant test suite passes.

## Work Log

### 2026-04-12 - Initial Discovery

**By:** Codex

**Actions:**

- Created a durable todo from screenshot feedback.
- Located the visible labels in `apps/manager/src/features/jobs/review-player/review-player-card.tsx`.
- Confirmed the related roadmap feature is already complete, making this a follow-up UI polish item.

**Learnings:**

- The review mode pill duplicates the `Before` / `After` control, and the subtitle track pill can read as an unnecessary second label for the same selected language.

### 2026-04-12 - Completed

**By:** Codex

**Actions:**

- Added a red server-render regression test for `ReviewPlayerCard` that fails when `Generated output` or `EN subtitles` appears in the player chrome.
- Removed the `.jobs-review-player-meta` pill row from `review-player-card.tsx`.
- Deleted the now-unused `.jobs-review-player-meta`, `.jobs-review-player-pill`, and `.jobs-review-player-pill-muted` CSS rules.
- Ran the focused review-player tests, full Manager Vitest suite, Manager lint, Manager typecheck, and `git diff --check`.
- Ran an authenticated user-like browser smoke against the real Manager job detail page using a local Strapi-shaped mock and captured screenshots:
  - `output/playwright/review-player-pill-cleanup-before.png`
  - `output/playwright/review-player-pill-cleanup-after.png`

**Learnings:**

- The review player is clearer when the mode switch is the single visible source of truth for Before / After state.
- The local browser smoke needs a safe local artifact asset id so the player can request the generated subtitle VTT without storage key errors.
